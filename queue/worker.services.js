/*!
 * MLP.API.Queue.Worker.Services
 * File: worker.services.js
* Copyright(c) 2023 Runtime Software Development Inc.
 * Version 2.0
 * MIT Licensed
 *
 * ----------
 * Description
 *
 * Image processing module.
 *
 * ---------
 * Revisions
 * - 29-07-2023   Refactored out Redis connection as separate queue service.
 */

'use strict';

import pool from "../src/services/db.services.js"; 
import {addQueueRecord} from "../src/queries/other.queries.js";
import {deleteFiles, insertFile} from "../src/services/files.services.js";
import * as stream from "stream";
import {mkdir, stat} from 'fs/promises';
import fs from 'fs';
import {ExifTool} from 'exiftool-vendored';
import sharp from 'sharp';
import path from 'path';
import {genUUID, sanitize} from '../src/lib/data.utils.js';
import * as util from "util"; 
import { v4 as uuidv4 } from 'uuid'; 


// import Jimp from 'jimp';
// import dcraw from 'dcraw';

/* Available image version sizes */

const imageSizes = {
    thumb: 150,
    medium: 900,
    full: 1500,
};


/**
 * Save processed raw image file and resampled versions.
 *
 * @public
 * @return {Promise} result
 * @param filename
 * @param metadata
 * @param owner
 * @param imageState
 * @param options
 * @param queue
 */

export const saveImage = async (filename, metadata, owner, imageState, options, queue) => {

    // generate unique filename ID token
    const imgToken = genUUID();

    // insert token into filename
    const tokenizedFilename = [
        filename.slice(0, filename.lastIndexOf('.')),
        imgToken,
        filename.slice(filename.lastIndexOf('.'))].join('');

    // create raw path directory (if does not exist)
    const rawPath = path.join(process.env.UPLOAD_DIR, owner.fs_path, imageState);
    await mkdir(rawPath, { recursive: true });

    const versions = {
        // create new filesystem path
        // - format: <UPLOAD_PATH>/<IMAGE_STATE>/<FILENAME>
        raw: {
            format: 'raw',
            path: path.join(rawPath, tokenizedFilename),
            size: null,
        },
        // resized versions
        thumb: {
            format: 'jpeg',
            path: path.join(process.env.LOWRES_PATH, `thumb_${imgToken}.jpeg`),
            size: imageSizes.thumb,
        },
        medium: {
            format: 'jpeg',
            path: path.join(process.env.LOWRES_PATH, `medium_${imgToken}.jpeg`),
            size: imageSizes.medium,
        },
        full: {
            format: 'jpeg',
            path: path.join(process.env.LOWRES_PATH, `full_${imgToken}.jpeg`),
            size: imageSizes.full,
        },
    };

    // update file metadata
    // - NOTE: ensure filesystem path does not include upload directory
    metadata.data.secure_token = imgToken;
    metadata.file.owner_type = owner.type;
    metadata.file.owner_id = owner.id;
    metadata.file.fs_path =  path.join(owner.fs_path, imageState, tokenizedFilename);

    // prepare metadata for transcoding
    const resData = {
        src: metadata.tmp,
        filename: filename,
        metadata: metadata,
        owner: owner,
        imageState: imageState,
        versions: versions,
        options: options,
    };

    // Queue image transcoding
    queue.add(resData);

    // return updated metadata
    return resData;
};


/**
 * Extract image file metadata.
 *
 * @src public
 * @param src
 * @param fileData
 * @param options
 * @param isRAW
 */

export const getImageInfo = async (
    src,
    fileData,
    options,
    isRAW
) => {

    // extract exif metadata using ExifTool (vendored)
    const exiftool = new ExifTool({ taskTimeoutMillis: 5000 });
    const exifTags = await exiftool.read(src);

    const {
        FileType = '',
        MIMEType = '',
        ImageWidth = 0,
        ImageHeight = 0,
        BitDepth='',
        ColorSpaceData='',
        Model = '',
        ProfileDateTime = '',
        ExposureTime = '',
        Fnumber = '',
        ISO = '',
        FocalLength = '',
        GPSLatitude = '',
        GPSLongitude = '',
        GPSAltitude = '',
    } = exifTags || {};

    // copy EXIF metadata
    if (
        ProfileDateTime
        && (fileData.file.file_type === 'modern_images' || fileData.file.file_type === 'historic_images')
    ) {
        fileData.data.capture_datetime = ProfileDateTime.toDate();
    }
    // fileData.file.file_size = info.size;
    fileData.file.mimetype = MIMEType;
    fileData.data.format = isRAW ? 'raw' : FileType;
    fileData.data.x_dim = ImageWidth;
    fileData.data.y_dim = ImageHeight;
    fileData.data.channels = ColorSpaceData === 'RGB' ? 3 : 1;
    fileData.data.density = sanitize(BitDepth, 'integer');
    // fileData.data.space = info.space;
    fileData.data.shutter_speed = sanitize(ExposureTime, 'float');
    fileData.data.f_stop = sanitize(Fnumber, 'float');
    fileData.data.iso = sanitize(ISO, 'integer');
    fileData.data.focal_length = sanitize(FocalLength, 'integer');
    fileData.data.lat = sanitize(GPSLatitude, 'float');
    fileData.data.lng = sanitize(GPSLongitude, 'float');
    fileData.data.elev = sanitize(GPSAltitude, 'float');

    // include camera model (if available)
    const camera = options.cameras
        .find(camera => camera.label === Model);
    if (camera) fileData.data.cameras_id = camera.value;

    await exiftool.end();

};

/**
 * Copy image files to library. Applies file conversion if requested, otherwise
 * skips conversion on raw files. Images are resized (if requested).
 *
 * @return {Object} output file data
 * @src public
 * @param src
 * @param output
 */

export const copyImageTo = async (src, output) => {

    // Disable Sharp cache
    sharp.cache(false);
    sharp.concurrency(1);

    // Create pipeline for saving and resizing the image, converting to JPEG
    // and use pipe to read from bucket read stream

    // const image = new Jimp(src, function (err, image) {
    //     const w = image.bitmap.width; //  width of the image
    //     const h = image.bitmap.height; // height of the image
    //     console.log(Jimp)
    // });

    const pipeline = util.promisify(stream.pipeline);

    async function run() {
        await pipeline(
            fs.createReadStream(src),
            output.format !== 'raw'
                ? sharp().resize({ width: output.size }).jpeg({ quality: 80 })
                : new stream.PassThrough(),
            fs.createWriteStream(output.path)
        );
    }

    await run().catch(console.error);
    console.log(`Raw image ${src} saved to ${output.path}.`)

};

/**
 * Process image files.
 *
 * @public
 * @return {Promise} result
 * @param data
 * @param callback
 */

export const processJob = async (job, callback) => {

    // extract queued data
    const { data = {} } = job || {};
    const {
        src = '',
        // filename = '',
        metadata = {},
        versions = {},
        owner = {},
        imageState = '',
        options = {},
    } = data || {};
    let isRAW = false;
    let copySrc = src;

    // NOTE: client undefined if connection fails.
    const client = await pool.connect();

    try {

        // read temporary image into buffer memory
        // record buffer size as file size
        //let buffer = await readFile(src);
        await stat(src).then(stats => {
            metadata.file.file_size = stats.size;
        });

        //
        // // convert RAW image to tiff
        // // Reference: https://github.com/zfedoran/dcraw.js/
        // let bufferRaw = dcraw(buffer, {
        //     useEmbeddedColorMatrix: true,
        //     exportAsTiff: true,
        //     useExportMode: true,
        // });
        //
        // // create temporary file for upload (if format is supported)
        // if (bufferRaw) {
        //     const tmpName = Math.random().toString(16).substring(2) + '-' + filename;
        //     copySrc = path.join(process.env.TMP_DIR, path.basename(tmpName));
        //     await writeFile(copySrc, bufferRaw);
        //     isRAW = true;
        // }
        // delete buffer
        // buffer = null;
        // bufferRaw = null;

        // get image metadata
        await getImageInfo(copySrc, metadata, options, isRAW);

        // add file record to database
        await insertFile(metadata, owner, imageState, callback, client);

        // copy image versions to data storage
        await copyImageTo(src, versions.raw);
        await copyImageTo(copySrc, versions.medium);
        await copyImageTo(copySrc, versions.thumb);
        await copyImageTo(copySrc, versions.full);

        // delete temporary files
        src === copySrc
            ? await deleteFiles([src])
            : await deleteFiles([src, copySrc]);

        return {
            raw: isRAW,
            src: copySrc,
            metadata: metadata,
        };
    } catch (err) {
        throw err;
    } finally {
        client.release(true);
    }
};



/**
 * Add record of queue job metadata
 *
 * @public
 * @param {Object} job - The job metadata to store
 * @return {Promise} result - The result of the query
 */
export const addQueueJob = async (error, job) => {

    // NOTE: client undefined if connection fails.
    const client = await pool.connect();

    const {id, data, timestamp} = job || {};

     // Example job details
     const metadata = {
        id: uuidv4(),
        job_id: id,
        status: error ? 'failed' : 'completed',
        created_at: new Date(timestamp).toISOString(),
        completed_at: new Date().toISOString(),
        error_message: error,
        additional_data: JSON.stringify(data)
    };

    // Add job to queue history
    try {

        // Get the SQL query and data to execute
        const { sql, data } = addQueueRecord(metadata);

        // Execute the query and return the result
        return await client.query(sql, data);

    } catch (err) {
        // Log any errors
        console.error(err);
    } finally {
        // Release the client connection
        await client.release(true);
    }
};