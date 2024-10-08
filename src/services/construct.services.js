/*!
 * MLP.API.Services.Construct
 * File: construct.services.js
 * Copyright(c) 2024 Runtime Software Development Inc.
 * MIT Licensed
 * 
 * Description: Create derived model through composition. The model schema
 * should have attributes that match the database table. 
 * 
 * Data Model:
 *  - Surveyors
 *    |- Surveys
 *      |- SurveySeasons
 *        |- Stations
 *          |- Historic Visits
 *            |- Historic Captures
 *          |- Modern Visits
 *            |- Locations
 *              |- Modern Captures
 *  - Projects
 *    |- Stations
*       |- Historic Visits
*          |- Historic Captures
*        |- Modern Visits
*          |- Locations
*            |- Modern Captures

 * - Map Feature Groups
 *    |- Map Feature
 * 
 */

'use strict';

import path from 'path';
import { humanize, sanitize } from '../lib/data.utils.js';
import * as schemaConstructor from './schema.services.js';
import { select as nselect } from './nodes.services.js';
import pool from "./db.services.js";

/**
 * Create derived model through composition. The model schema
 * should have attributes that match the database table.
 *
 * @param {String} modelType
 * @src public
 */

/**
 * Create derived model through composition. The model schema
 * should have attributes that match the database table.
 *
 * @param {String} modelType
 * @return {Object} model constructor
 * @src public
 */
export const create = async (modelType) => {

    // generate schema for constructor type
    let Schema = await schemaConstructor.create(modelType);
    const schema = new Schema();

    // return constructor
    return function(attributeValues) {

        // static variables
        this.name = modelType;
        this.key = `${modelType}_id`;
        this.idKey = schema.idKey;
        this.label = schemaConstructor.genLabel(modelType, attributeValues);
        this.attributes = schema.attributes;
        this.isRoot = schema.rootNodeTypes.includes(modelType);
        this.depth = schema.nodeDepth.hasOwnProperty(modelType)
            ? schema.nodeDepth[modelType]
            : schema.nodeDepth.default;
        // set filesystem root (if root node)
        this.fsRoot = schema.fsRoot.hasOwnProperty(modelType)
            ? schema.fsRoot[modelType]
            :'Unknown';

        // initialize model with input data
        this.setData = setData;
        this.setData(attributeValues);

        // method definitions
        Object.defineProperties(this, {

            /**
             * Get/set node/file id value.
             *
             * @return {Object} field data
             * @src public
             */
            id: {
                get: () => {
                    return schema.idKey && this.attributes[schema.idKey].value || '';
                },
                set: (id) => {
                    this.attributes[schema.idKey || 'unknown'].value = id;
                }
            },

            /**
             * Check for existence of attribute in model.
             *
             * @return {Object} field data
             * @src public
             */
            hasAttribute: {
                value: (attr) => {
                    return schema.attributes.hasOwnProperty(attr);
                },
                writable: true
            },

            /**
             * Add a new attribute to the model.
             *
             * @return {Object} field data
             * @src public
             */
            addAttribute: {
                value: (name, type, value=null) => {
                    this.attributes[name] = {
                        value: value,
                        key: name,
                        label: humanize(name),
                        type: type,
                    };
                },
                writable: true
            },

            /**
             * Get the nodes reference data (if exists).
             *
             * @return {Object} field data
             * @src public
             */
            node: {
                get: () => {
                    return schema.attributes.hasOwnProperty('nodes_id')
                        ? this.attributes['nodes_id']
                        : null;
                },
                set: (data) => {
                    if (schema.attributes.hasOwnProperty('nodes_id'))
                        this.attributes['nodes_id'].data = data;
                }
            },

            /**
             * Get/set the files reference data (if exists).
             *
             * @return {Object} field data
             * @src public
             */
            file: {
                get: () => {
                    return schema.attributes.hasOwnProperty('files_id')
                        ? this.attributes['files_id']
                        : null;
                },
                set: (data) => {
                    if (schema.attributes.hasOwnProperty('files_id'))
                        this.attributes['files_id'].data = data;
                }
            },

            /**
             * Get/set the node/file owner data.
             *
             * @return {Object} field data
             * @src public
             */
            owner: {
                get: () => {
                    return schema.attributes.hasOwnProperty('owner_id')
                        ? this.attributes['owner_id']
                        : null;
                },
                set: (id) => {
                    if ((typeof id === 'number' || typeof id === 'string') && this.attributes.hasOwnProperty('owner_id')) {
                        this.attributes['owner_id'].value = sanitize(id);
                    }
                }
            },

            /**
             * Get field value from model attributes.
             *
             * @param {String} field
             * @return {Object} field data
             * @src public
             */
            getValue: {
                value: (field=null) => {
                    return field && this.attributes.hasOwnProperty(field)
                        ? this.attributes[field].value
                        : null;
                },
                writable: false
            },

            /**
             * Set field value in model schema.
             *
             * @param {String} key
             * @param {Object} value
             * @src public
             */
            setValue: {
                value: (key, value) => {
                    if (typeof key === 'string' && this.attributes.hasOwnProperty(key)) {
                        this.attributes[key].value = sanitize(value, this.attributes[key].type);
                    }
                },
                writable: false
            },

            /**
             * Get field values from model. Optional filter array
             * omits select attributes from result.
             *
             * @return {Object} filtered data
             * @param {Array} filter
             * @src public
             */
            getData: {
                value: (filter=[]) => {
                    return Object.keys(this.attributes)
                        .filter(key => !filter.includes(key))
                        .reduce((o, key) => {
                            o[key] = this.attributes[key].value; return o
                        }, {});
                },
                writable: false
            },

            /**
             * Clear attributes of all values.
             *
             * @src public
             */
            clear: {
                value: () => {
                    this.attributes = Object.keys(this.attributes)
                        .map(key => {
                            this.attributes[key].value = null;
                        });
                },
                writable: false
            }
        });
    }
};


/**
 * Sets values of model attributes.
 *
 * @param {Object} data
 * @return {this}
 * @src public
 */
function setData(data=null) {

    // select object-defined data
    if (typeof data === 'object' && data !== null) {

        // NOTE: model can only hold data for single record
        // select either first row of data array or single data object
        const inputData = data.hasOwnProperty('rows') ? data.rows[0] : data;

        // assert attributes exist in model schema
        // NOTE: we silently ignore attributes not present in model schema
        Object.keys(inputData)
            .filter(key => !(this.attributes && this.attributes.hasOwnProperty(key)))
            .map(key => {
                console.warn(`Attribute key \'${key}\' was not in model schema for \'${this.name}\'.`);
            });

        // set attribute values from data
        Object.keys(inputData)
            .filter(key => this.attributes && this.attributes.hasOwnProperty(key))
            .map(key => this.attributes[key].value =
                sanitize(inputData[key], this.attributes[key].type));
    }

    return this;
}

/**
 * Generates node object from given model instance.
 *
 * @public
 * @params {Object} item
 * @return {Promise} result
 */

export const createNode = async function(item) {

    // NOTE: client undefined if connection fails.
    const client = await pool.connect();

    try {
        if (!item.node) return null;

        // generate node constructor
        let Node = await create('nodes');

        // get owner attributes (if they exist)
        const { owner={} } = item || {};
        const { value='' } = owner || {};
        let ownerAttrs = await nselect(value, client) || owner;
        const { id=null, type=null, fs_path=item.fsRoot } = ownerAttrs || {};

        // create new filesystem path using generated node label
        // - only return alphanumeric characters (also: '_', '-')
        const fsPath = path.join(
            fs_path,
            item.label.replace(' ', '_').replace(/[^a-z0-9_-]/gi,'')
        );

        // return node instance: set owner attribute values from
        // retrieved node attributes
        return new Node({
            id: item.id,
            type: item.name,
            owner_id: id,
            owner_type: type,
            fs_path: fsPath
        });

    } catch (err) {
        console.error(err)
        throw err;
    } finally {
        await client.release(true);
    }
};

/**
 * Generates file object from given model instance
 * and file metadata.
 *
 * @public
 * @params {Object} item
 * @return {Promise} result
 */

export const createFile = async function(fileData) {

    if (!fileData) return null;

    // generate file constructor
    let File = await create('files');

    // get additional file metadata from item
    const {
        id='',
        file_type='',
        filename='',
        mimetype='',
        owner_type='',
        owner_id='',
        fs_path='',
        file_size=0,
        filename_tmp=''
    } = fileData || {};


    // return file instance: set owner attribute values from
    // retrieved node attributes
    return new File({
        id: id,
        file_type: file_type,
        filename: filename,
        file_size: file_size,
        mimetype: mimetype,
        owner_id: owner_id,
        owner_type: owner_type,
        fs_path: fs_path,
        filename_tmp: filename_tmp
    });
};


