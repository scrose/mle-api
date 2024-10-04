/*!
 * MLP.API.Services.Images
 * File: images.services.js
* Copyright(c) 2024 Runtime Software Development Inc.
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
 * - 26-09-2024   Simplified image save function.
 */

'use strict';

import {mkdir} from 'fs/promises';
import path from 'path';
import {genUUID} from '../lib/data.utils.js';
import { addQueueJob } from '../../queue/worker.services.js';

/**
 * Available image version sizes 
 * - used to set default image size by width
 * - thumb: thumbnail image
 * - medium: large image
 * - full: full sized image
 * */

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

    // get filename
    const filename = 

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

    // prepare metadata for image processing job
    const jobData = {
        src: metadata.tmp,
        filename: filename,
        metadata: metadata,
        owner: owner,
        imageState: imageState,
        versions: versions,
        options: options,
    };

    // Add file to processing queue
    try {
        await queue.add(jobData);
        console.log('Job added to queue');
    } catch (error) {
        console.error('Error adding job to queue:', error);
        await addQueueJob(error, jobData);
    }
    
    // return updated metadata
    return jobData;
};


/**
 * Create file source URLs for resampled images from file data.
 *
 * @public
 * @param {String} type
 * @param {Object} data
 * @return {Promise} result
 */

export const getImageURL = (type = '', data = {}) => {

    const { secure_token = '' } = data || {};
    const rootURI =`${process.env.API_HOST}/uploads/`;

    // generate resampled image URLs
    const imgSrc = (token) => {
        return Object.keys(imageSizes).reduce((o, key) => {
            o[key] = new URL(`${key}_${token}.jpeg`, rootURI);
            return o;
        }, {});
    };

    // handle image source URLs
    // - images use scaled versions of raw files
    const fileHandlers = {
        historic_images: () => {
            return imgSrc(secure_token);
        },
        modern_images: () => {
            return imgSrc(secure_token);
        },
        supplemental_images: () => {
            return imgSrc(secure_token);
        },
    };

    // Handle file types
    return fileHandlers.hasOwnProperty(type) ? fileHandlers[type]() : null;
};
