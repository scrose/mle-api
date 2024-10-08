/*!
 * MLP.API.Services.Files
 * File: files.services.js
 * Copyright(c) 2024 Runtime Software Development Inc.
 * MIT Licensed
 * 
 * Description: File services module for the API.
 */

'use strict';

import path from 'path';
import fs from 'fs';
import {Buffer} from 'node:buffer';
import {copyFile, mkdir, rename, unlink} from 'fs/promises';
import pool from './db.services.js';
import queries from '../queries/index.queries.js';
import {sanitize} from '../lib/data.utils.js';
import * as cserve from './construct.services.js';
import * as metaserve from '../services/metadata.services.js';
import ModelServices from './model.services.js';
import {allowedImageMIME, allowedMIME, extractFileLabel} from '../lib/file.utils.js';
import {getImageURL, saveImage} from './images.services.js';
import {updateComparisons} from "./comparisons.services.js";
import * as nserve from "./nodes.services.js";
import AdmZip from 'adm-zip';
import archiver from 'archiver';
import {Readable} from "stream";
import queue from './queue.services.js';

/**
 * Maximum file size (non-images) = 1GB
 */

const MAX_FILE_SIZE = 1e9;

/**
 * Capture types.
 */

const captureTypes = ['historic_captures', 'modern_captures'];

/**
 * Get file record by ID. NOTE: returns single object.
 *
 * @public
 * @param {integer} id
 * @param client
 * @return {Promise} result
 */

export const select = async function(id, client ) {
    let { sql, data } = queries.files.select(id);
    let file = await client.query(sql, data);
    return file.rows[0];
};


/**
 * Get list of requested files by IDs.
 *
 * @public
 * @return {Promise} result
 * @param fileIDs
 * @param file_type
 * @param offset
 * @param limit
 */

export const filterFilesByID = async (fileIDs, file_type, offset, limit) => {

    if (!fileIDs) return null;

    // NOTE: client undefined if connection fails.
    const client = await pool.connect();

    try {
        // start transaction
        await client.query('BEGIN');

        // get filtered nodes
        let { sql, data } = queries.files.filterByIDArray(fileIDs, file_type, offset, limit);
        let files = await client.query(sql, data)
            .then(res => {
                return res.rows
            });

        const count = files.length > 0 ? files[0].total : 0;

        // end transaction
        await client.query('COMMIT');

        return {
            query: fileIDs,
            limit: limit,
            offset: offset,
            results: files,
            count: count
        };

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        await client.release(true);
    }
};

/**
 * Get file label.
 *
 * @public
 * @param {Object} file
 * @param client
 * @return {Promise} result
 */

export const getFileLabel = async (file, client) => {

    if (!file) return '';
    const {file_type = '', owner_id = '', filename = ''} = file || {};

    // get image owner
    const owner = await nserve.select(sanitize(owner_id, 'integer'), client);
    // check that owner node exists
    if (!owner) return '';
    const metadata = await nserve.selectByNode(owner, client);

    const queriesByType = {
        historic_images: async () => {
            const {fn_photo_reference = ''} = metadata || {};
            return fn_photo_reference
                ? fn_photo_reference
                : extractFileLabel(filename, 'Capture Image');
        },
        modern_images: async () => {
            const {fn_photo_reference = ''} = metadata || {};
            return fn_photo_reference
                ? fn_photo_reference
                : extractFileLabel(filename, 'Capture Image');
        },
        default: async () => {
            return extractFileLabel(filename, filename) || 'File Unknown';
        }
    };

    return queriesByType.hasOwnProperty(file_type)
        ? await queriesByType[file_type]() : queriesByType.default();

};

/**
 * Get file data by file ID. Returns single node object.
 *
 * @public
 * @param {String} id
 * @param client
 * @return {Promise} result
 */

export const get = async (id, client ) => {

    if (!id) return null;

    // get requested file
    const file = await select(sanitize(id, 'integer'), client);

    // check that file exists
    if (!file) return null;

    // get associated file metadata
    const metadata = await selectByFile(file, client) || {};
    const { type = '', secure_token = '' } = metadata || {};
    const { file_type = '', filename = '', owner_id=0, file_size=0 } = file || {};
    const owner = await nserve.select(owner_id, client) || {};
    const label = await getFileLabel(file, client);

    // include alternate extracted filename (omit the security token)
    return {
        id: id,
        file: file,
        owner: owner,
        file_type: file_type,
        file_size: file_size,
        label: label,
        filename: (filename || '').replace(`_${secure_token}`, ''),
        metadata: metadata,
        metadata_type: await metaserve.selectByName('metadata_file_types', type, client),
        url: getImageURL(file_type, metadata),
        status: await metaserve.getStatus(owner, client),
    }

};

/**
 * Select files attached to a given owner (Does not include dependent files).
 *
 * @public
 * @param {integer} id
 * @param client
 * @return {Promise} result
 */

export const selectByOwner = async (id, client ) => {

    // get all dependent files for requested owner
    const { sql, data } = queries.files.selectByOwner(id);
    const { rows = [] } = await client.query(sql, data);

    // append full data for each dependent node
    let files = await Promise.all(
        rows.map(
            async (file) => {
                const { file_type = '', filename = '' } = file || {};
                const fileMetadata = await selectByFile(file, client);
                const { type = '', secure_token = '' } = fileMetadata || {};
                return {
                    file: file,
                    label: await getFileLabel(file, client),
                    filename: (filename || '').replace(`_${secure_token}`, ''),
                    metadata: fileMetadata,
                    metadata_type: await metaserve.selectByName('metadata_file_types', type, client),
                    url: getImageURL(file_type, fileMetadata),
                };
            }),
    );

    // group files by type
    return files.reduce((o, f) => {
        const { file = {} } = f || {};
        const { file_type = 'files' } = file || {};

        // create file group
        if (!o.hasOwnProperty(file_type)) {
            o[file_type] = [];
        }

        // add file to group
        o[file_type].push(f);
        return o;
    }, {});
};

/**
 * Select all files under a given node
 *
 * @public
 * @params {Object} owner
 * @return {Promise} result
 */

export const selectAllByOwner = async (id) => {

    if (!id) return null;

    // NOTE: client undefined if connection fails.
    const client = await pool.connect();

    let results = {}

    // query handlers for different file types
    const handlers = {
        historic_images: async () => {
            const {sql, data} = queries.files.getHistoricImageFilesByStationID(id);
            const {rows = []} = await client.query(sql, data);
            return rows.map(row => {
                row.url = getImageURL('historic_images', row);
                return row
            });
        },
        modern_images: async () => {
            const {sql, data} = queries.files.getModernImageFilesByStationID(id);
            const {rows = []} = await client.query(sql, data);
            return rows.map(row => {
                row.url = getImageURL('modern_images', row);
                return row
            });
        },
        unsorted_images: async () => {
            const {sql, data} = queries.files.getUnsortedImageFilesByStationID(id);
            const {rows = []} = await client.query(sql, data);
            return rows.map(row => {
                row.url = getImageURL('modern_images', row);
                return row
            });
        },
        // supplemental_images: async () => {
        //     const {sql, data} = queries.files.getUnsortedImageFilesByStationID(id);
        //     const {rows = []} = await client.query(sql, data);
        //     return rows.map(row => {
        //         row.url = getImageURL('modern_images', row);
        //         return row
        //     });
        // }
    }

    try {
        // start transaction
        await client.query('BEGIN');

        // get all dependent files for requested owner
        results.historic_images = await handlers.historic_images();
        results.modern_images = await handlers.modern_images();
        results.unsorted_images = await handlers.unsorted_images();

        await client.query('COMMIT');
        return results

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        await client.release(true);
    }
};

/**
 * Check if node has attached files.
 *
 * @public
 * @param {integer} id
 * @param client
 * @return {Promise}
 */

export const hasFiles = async (id, client) => {
    let { sql, data } = queries.files.hasFile(id);
    return await client.query(sql, data)
        .then(res => {
            return res.hasOwnProperty('rows') && res.rows.length > 0
                ? res.rows[0].exists
                : false;
        });
};

/**
 * Get model data by file reference. Returns single node object.
 *
 * @public
 * @param {Object} file
 * @param client
 * @return {Promise} result
 */

export const selectByFile = async (file, client ) => {
    let { sql, data } = queries.defaults.selectByFile(file);
    return await client.query(sql, data)
        .then(res => {
            return res.hasOwnProperty('rows')
            && res.rows.length > 0 ? res.rows[0] : {};
        });
};

/**
 * Recursively list files in a directory.
 *
 * @public
 * @param localPath
 * @param done
 * @return {Array} files
 */

export const listFiles = (localPath, done=()=>{}) => {
    // get root directories
    const lowResPath = process.env.LOWRES_PATH;
    const defaultPath = process.env.UPLOAD_DIR;
    // joining path of local directory to root path
    const dir = path.join(defaultPath, localPath);

    let results = [];
    fs.readdir(dir, function(err, list) {
        if (err) return done(err);
        let i = 0;
        (function next() {
            let file = list[i++];
            if (!file) return done(null, results);
            file = path.resolve(dir, file);
            fs.stat(file, function(err, stat) {
                console.log(stat)
                if (stat && stat.isDirectory()) {
                    listFiles(file, function(err, res) {
                        results = results.concat(res);
                        next();
                    });
                } else {
                    results.push(file);
                    next();
                }
            });
        })();
    });
};

/**
 * Insert file(s) and file metadata.
 * - import data structure:
 *      files: [{
            file: {
                file_type: <FILE_TYPE>,
                mimetype: <MIMETYPE>,
                filename: <FILENAME>,
                file_size: <FILESIZE>,
                fs_path: <FS_PATH>,
                filename_tmp: <TMP_FILENAME>
            },
            metadata: { additional file metadata, e.g. image metadata },
        }],
 *      owner: { file owner instance }
 *
 * @public
 * @param {Object} importData
 * @param {String} model
 * @param {Object} fileOwner
 * @return {Promise} result
 */

export const insert = async (files, owner, client) => {
    try {

        // reject null parameters
        if (Array.isArray(files) && files.length === 0 || !owner ) {
            return null;
        }

        // get file options
        const options = await metaserve.getMetadataOptions(client);

        // saves attached files and inserts metadata record for each
        return await Promise
            .all(Object.values(files)
            .map( async (file) => {
                const FileModel = await cserve.create(file?.file_type);
                const fileModel = new FileModel(file.metadata); 
                // set owner id and node type
                file.setValue('owner_id', owner.id);
                file.setValue('owner_type', owner.name);
                return saveFile(file, owner, options, client);
            }))

    } catch (err) {
        throw err;
    }
};

/**
 * Update file metadata in existing record.
 *
 * @public
 * @param file
 * @param metadata
 * @param client
 * @return {Promise} result
 */

export const update = async (file, metadata, client) => {

    try {
        // start transaction
        await client.query('BEGIN');

        // touch file node record
        const fileNodeQuery = queries.files.touch(file);
        await client.query(fileNodeQuery.sql, fileNodeQuery.data);

        // update files record
        const fileQuery = queries.files.update(file);
        await client.query(fileQuery.sql, fileQuery.data);

        // update metadata record
        const metadataQuery = queries.files.update(metadata);
        let response = await client.query(metadataQuery.sql, metadataQuery.data);

        await client.query('COMMIT');

        return response.hasOwnProperty('rows') && response.rows.length > 0
            ? response.rows[0]
            : null;

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }

};



/**
 * Download file stream.
 *
 * @src public
 * @param res
 * @param src
 */

export const download = async (res, src) => {
    return new Promise(async (resolve, reject) => {
        try {
            const readStream = fs.createReadStream(src);
            readStream.pipe(res);

            readStream.on('error', (err) => {
                console.warn('Error in read stream...', err);
            });
            res.on('error', (err) => {
                console.warn('Error in write stream...', err);
            });

        } catch (err) {
            reject(err);
        }
    });
};

/**
 * Compress requested files in a zipped folder
 * - input param contains file objects
 *
 * @param {Object} files
 * @param {String} version
 * @return Response data
 * @public
 */

export const compress = async (files={}, version) => {

    // creating new archive (ADM-ZIP)
    let zip = new AdmZip();

    // add requested files to archive; separate different file types in folders
    await Promise.all(
        Object.keys(files).map(async (fileType) => {
            await Promise.all(
                files[fileType].map(async (file) => {
                    // get file path for given version type
                    const filePath = getFilePath(file, version);
                    // places file in a subfolder labelled by image/file type
                    // - only include files that exist
                    if (fs.existsSync(filePath)) zip.addLocalFile(filePath, fileType);
                })
            )}
        )
    );

    // return file buffer
    return zip.toBuffer();
};

/**
 * Build file source path for resampled images and metadata files
 * from file data.
 *
 * @public
 * @param file
 * @param version
 * @return {String} result
 */

export const getFilePath = (file, version='medium' ) => {

    const { fs_path = '', secure_token = '', file_type='' } = file || {};
    const lowResPath = process.env.LOWRES_PATH;
    const defaultPath = process.env.UPLOAD_DIR;

    // handle image source URLs differently than metadata files
    // - images use scaled versions of raw files
    // - metadata uses PDF downloads
    const fileHandlers = {
        historic_images: () => {
            return version === 'raw'
                ? path.join(path.join(defaultPath, fs_path))
                : path.join(lowResPath, `${version}_${secure_token}.jpeg`);
        },
        modern_images: () => {
            return version === 'raw'
                ? path.join(path.join(defaultPath, fs_path))
                : path.join(lowResPath, `${version}_${secure_token}.jpeg`);
        },
        supplemental_images: () => {
            return version === 'raw'
                ? path.join(path.join(defaultPath, fs_path))
                : path.join(lowResPath, `${version}_${secure_token}.jpeg`);
        },
        default: () => {
            return path.join(path.join(defaultPath, fs_path));
        },
    };

    // Handle file types
    return fileHandlers.hasOwnProperty(file_type)
        ? fileHandlers[file_type]()
        : fileHandlers.default();
};

/**
 * Insert file metadata to database.
 *
 * @src public
 * @param importData
 * @param owner
 * @param imageState
 * @param callback
 * @param client
 */

export const insertFile = async (file, owner, client) => {


    // create file node instance
    // - use file model instance with extracted file data
    const stmtFileNode = queries.files.insert(file);
    let fileRes = await client.query(stmtFileNode.sql, stmtFileNode.data);

    // update file metadata files_id with created file ID, defined image state
    const { id = '' } = fileRes.hasOwnProperty('rows') && fileRes.rows.length > 0
        ? fileRes.rows[0] || {}
        : {};
    fileItem.id = id;

    // insert file metadata as new record
    // NOTE: need to define different query than current services object model
    const stmtFileData = queries.defaults.insert(fileItem)(fileItem);
    let modelRes = await client.query(stmtFileData.sql, stmtFileData.data);

    // return confirmation data
    return modelRes.hasOwnProperty('rows') && modelRes.rows.length > 0
        ? {
            file: fileRes.rows[0],
            metadata: modelRes.rows[0],
        }
        : null;
}

/**
 * Move files to new owner (container)
 *
 * @src public
 * @param files
 * @param node
 * @param client
 */

export const moveFiles = async (files, node, client) => {
    await Promise.all(
        // handle move for each file type
        Object.keys(files).map(async (fileType) => {
            await Promise.all(
                // handle move for each file
                files[fileType].map(async (fileData) => {
                    const {metadata = {}, file = {}} = fileData || {};
                    const {image_state = '', secure_token = ''} = metadata || {};
                    const {filename = '', file_type = ''} = file || {};

                    // insert token into filename
                    const tokenizedFilename = [
                        filename.slice(0, filename.lastIndexOf('.')),
                        secure_token,
                        filename.slice(filename.lastIndexOf('.'))
                    ].join('');

                    // check node has file directory path
                    if (!node.getValue('fs_path') || !file.fs_path) return null;

                    // get the old file path
                    const oldFileUploadPath = path.join(process.env.UPLOAD_DIR, file.fs_path);
                    // create new directory and file path (create directory if does not exist)
                    const newFileNodePath = path.join(node.getValue('fs_path'), image_state || file_type);
                    const newFileUploadDir = path.join(process.env.UPLOAD_DIR, newFileNodePath);
                    await mkdir(newFileUploadDir, {recursive: true});
                    // move file to new directory path
                    const newFileUploadPath = path.join(newFileUploadDir, tokenizedFilename);
                    // rename file path (if exists)
                    if (fs.existsSync(oldFileUploadPath)) await rename(oldFileUploadPath, newFileUploadPath);

                    // update owner in file metadata model
                    const FileModel = await cserve.create(file_type);
                    const fileMetadata = new FileModel(metadata);
                    fileMetadata.owner = node.id;

                    // updated file path in file model
                    let fileNode = await cserve.createFile(file);
                    fileNode.setValue('fs_path', path.join(newFileNodePath, tokenizedFilename));

                    // create file node instance from file model instance
                    await update(fileNode, fileMetadata, client);
                })
            );
        })
    );
}

/**
 * Delete model-type-indexed files and metadata.
 *
 * @param files
 * @param client
 * @return Response data
 * @public
 */

export const removeAll = async (files=null, client ) => {
    await Promise.all(
        Object.keys(files).map(
            async (file_type) => {
                await Promise.all(
                    files[file_type].map( async (file) => {
                        return await remove(file, client);
                    }));
            })
    );
}

/**
 * Delete file(s) and metadata for given file entry.
 *
 * @param fileItem
 * @param client
 * @return Response data
 * @public
 */

export const remove = async (fileItem=null, client ) => {
    const { file=null, url=null } = fileItem || {};
    const { id='', fs_path='' } = file || {};

    // create filepath array (include original or raw file)
    let filePaths = [path.join(process.env.UPLOAD_DIR, fs_path)];

    // include any image resampled versions (if applicable)
    if (url) {
        Object.keys(url).reduce((o, key) => {
            const filename = url[key].pathname.replace(/^.*[\\\/]/, '');
            o.push(path.join(process.env.LOWRES_PATH, filename));
            return o;
        }, filePaths)
    }

    // [1] remove file + metadata records
    const {sql, data} = queries.files.remove(id);
    const response = await client.query(sql, data) || [];

    // [2] delete attached files
    // - assumes file paths are to regular files.
    // await deleteFiles(filePaths);

    // return response data
    return response.hasOwnProperty('rows') && response.rows.length > 0
        ? response.rows[0]
        : null;
};

/**
 * Delete files from filesystem (by file paths).
 *
 * @param filePaths
 * @return Response data
 * @public
 */

export const deleteFiles = async (filePaths=[]) => {
    await Promise.all(
        filePaths.map(async (filePath) => {
            fs.stat(filePath, async (err) => {
                if (err == null) {
                    return await unlink(filePath);
                } else if (err.code === 'ENOENT') {
                    // file does not exist (ignore)
                    console.warn(err);
                    return null;
                } else {
                    throw err;
                }
            });
        })
    );
};

/**
 * Stream archive data to response
 *
 * @return Response data
 * @public
 * @param {Response} res
 * @param {Object} files
 * @param {String} version
 * @param metadata
 */

export const streamArchive = async (res, files={}, version, metadata={}) => {

    res.on('error',function(err) {
        console.error(err);
        res.status(404).end();
    });

    // create an archive
    const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
    });

    // listen for all archive data to be written
    // 'close' event is fired only when a file descriptor is involved
    res.on('close', function() {
        console.log(archive.pointer() + ' total bytes');
        console.log('archiver has been finalized and the output file descriptor has closed.');
    });

    // This event is fired when the data source is drained no matter what was the data source.
    // It is not part of this library but rather from the NodeJS Stream API.
    // @see: https://nodejs.org/api/stream.html#stream_event_end
    res.on('end', function() {
        console.log('Data has been drained');
    });

    // good practice to catch warnings (ie stat failures and other non-blocking errors)
    archive.on('warning', function(err) {
        if (err.code === 'ENOENT') {
            // log warning
        } else {
            // throw error
            throw err;
        }
    });

    // good practice to catch this error explicitly
    archive.on('error', function(err) {
        throw err;
    });

    // pipe data to response
    archive.pipe(res);

    // add requested files to archive; separate different file types in folders
    await Promise.all(
        Object.keys(files).map(async (fileType) => {
            await Promise.all(
                files[fileType].map(async (file, index) => {
                    // get file path for given version type
                    const filePath = getFilePath(file, version);
                    const {filename=``} = file || {};
                    // places file in a subfolder labelled by image/file type
                    // - only include files that exist
                    if (fs.existsSync(filePath)) {
                        // append a file
                        archive.file(filePath, { name: path.join(fileType, filename)});
                    }
                })
            )}
        )
    );

    // finalize the archive (ie we are done appending files but streams have to finish yet)
    // 'close', 'end' or 'finish' may be fired right after calling this method so register to them beforehand
    await archive.finalize();

    // return archive
    return archive;
};

/**
 * Stream readable data to response
 * - pushes data buffer to readable stream
 *
 * @return Response data
 * @public
 * @param res
 * @param buffer
 *
 */

export const streamDownload = (res, buffer) => {
    let rs = new Readable();

    // set buffer size in response
    res.setHeader('Content-Length', Buffer.byteLength(buffer));

    // pipe stream to response
    rs.pipe(res);
    rs.on('error',function(err) {
        console.error(err);
        res.status(404).end();
    });
    // pipe archive data to the file
    // archive.pipe(output);
    rs.push(buffer);
    rs.push(null);
}

/**
 * Bulk download files
 *
 * @public
 * @param req
 * @param res
 * @param next
 * @param version
 * @param client
 */

export const bulkDownload = async (req, res, next, version, client) => {

    const offset = 0;
    const limit = 100;

    // extract query parameters
    const {
        file_id='',
        id='',
        historic_images='',
        modern_images='',
        metadata_files='',
        supplemental_images='',
        unsorted_images=''
    } = req.query || {};

    if (
        !file_id &&
        !id &&
        !historic_images &&
        !modern_images &&
        !metadata_files &&
        !supplemental_images &&
        !unsorted_images)
        return next(new Error('invalidRequest'));

    // stream single image file without compression
    if (file_id) {
        // get owner node; check that node exists in database
        // and corresponds to requested owner type.
        const fileData = await get(sanitize(file_id, 'integer'), client);
        const { file={} } = fileData || {};
        const { filename='', mime_type='' } = file || {};
        const filePath = getFilePath(file, version);

        // file does not exist
        if (!file) return next(new Error('invalidRequest'));

        res.setHeader('Content-disposition', 'attachment; filename=' + filename);
        res.setHeader('Content-type', mime_type);

        return await download(res, filePath);
    }

    // sanitize single file ID
    const singleFileId = sanitize(id, 'integer');

    // sanitize + convert query string to node id array
    const historicFileIDs = historic_images
        .split(' ')
        .map(id => {
            return sanitize(id, 'integer');
        });

    const modernFileIDs = modern_images
        .split(' ')
        .map(id => {
            return sanitize(id, 'integer');
        });

    const unsortedFileIDs = unsorted_images
        .split(' ')
        .map(id => {
            return sanitize(id, 'integer');
        });

    const metadataFileIDs = metadata_files
        .split(' ')
        .map(id => {
            return sanitize(id, 'integer');
        });

    const supplementalFileIDs = supplemental_images
        .split(' ')
        .map(id => {
            return sanitize(id, 'integer');
        });

    // get filtered files by ID
    const singleFile = await select(singleFileId, client);
    const historicFiles = await filterFilesByID(historicFileIDs, 'historic_images', offset, limit);
    const modernFiles = await filterFilesByID(modernFileIDs, 'modern_images', offset, limit);
    const metadataFiles = await filterFilesByID(metadataFileIDs, 'metadata_files', offset, limit);
    const supplementalFiles = await filterFilesByID(supplementalFileIDs, 'supplemental_images', offset, limit);
    const unsortedFiles = await filterFilesByID(unsortedFileIDs, null, offset, limit);

    // stream archive data for either single file or compressed image folder
    return singleFile
        ? await streamArchive(res, {file: [singleFile]}, version)
        : await streamArchive(res, {
            'historic_images': historicFiles.results,
            'modern_images': modernFiles.results,
            'unsorted_images': unsortedFiles.results,
            'metadata_files': metadataFiles.results,
            'supplemental_files': supplementalFiles.results,
        }, version);
}

