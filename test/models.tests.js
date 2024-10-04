/*!
 * MLP.API.Tests.Models
 * File: users.test.js
 * Copyright(c) 2021 Runtime Software Development Inc.
 * MIT Licensed
 */

/**
 * Module dependencies.
 * @private
 */

import path from 'path';
import { server, compare, BASE_URL } from './setup.js';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { errors } from '../src/error.js';
import { humanize, toSnake } from '../src/lib/data.utils.js';

/** 
 * Create mock items.
 * @private
 */

let mockItems = {
    projects: {
        nodes_id: null,
        name: 'Name Text',
        description: 'Description Text',
    },
    surveyors: {
        nodes_id: null,
        given_names: 'Given Names',
        last_name: 'Last Name',
        short_name: 'TEST',
        affiliation: "Affiliation"
    },
    surveys: {
        nodes_id: null,
        owner_id: 16,
        name: 'Some Name',
        historical_map_sheet: 'Historical Map Sheet',
    },
    surveySeasons: {
        nodes_id: null,
        owner_id: 151,
        year: 1933,
        geographic_coverage: 'TEST',
        record_id: 0,
        jurisdiction: 'TEST',
        affiliation: 'TEST',
        archive: 'TEST',
        collection: 'TEST',
        location: 'TEST',
        sources: 'TEST',
        notes: 'TEST'
    },
    stations: {
        nodes_id: null,
        owner_id: 312,
        name: 'TEST',
        lat: 100.1,
        long: 100.1,
        elev: 100.1,
        nts_sheet: 'TEST'
    },
    historicVisits: {
        nodes_id: null,
        owner_id: 805,
        date: '1927-01-01',
        comments: 'TEXT'
    },
    modernVisits: {
        nodes_id: null,
        owner_id: 805,
        date: '2005-08-19',
        start_time: '14:00:00',
        finish_time: '17:00:00',
        pilot: 'TEST',
        rw_call_sign: 'TEXT',
        visit_narrative: 'TEXT',
        illustration: false,
        weather_narrative: 'TEXT',
        weather_temp: 14,
        weather_ws: 25,
        weather_gs: 34,
        weather_pressure: 101,
        weather_rh: 15,
        weather_wb: 22
    },
    locations: {
        nodes_id: null,
        owner_id: 6635,
        location_narrative: 'TEXT',
        location_identity: 'TEXT',
        lat: 100.1,
        long: 100.1,
        elev: 100.1,
        legacy_photos_start: 5,
        legacy_photos_end: 8
    },
    historicCaptures: {
        nodes_id: null,
        owner_id: 4328,
        plate_id: '529',
        fn_photo_reference: 'TEXT',
        f_stop: 555,
        shutter_speed: 34,
        focal_length: 12,
        capture_datetime: '2014-07-09 16:49:00.572006',
        cameras_id: 6,
        lens_id: null,
        digitization_location: 'LAC',
        digitization_datetime: '2014-07-09 16:49:00.572006',
        lac_ecopy: 'IDENTIFIER',
        lac_wo: 'IDENTIFIER',
        lac_collection: 'IDENTIFIER',
        lac_box: 'IDENTIFIER',
        lac_catalogue: 'IDENTIFIER',
        condition: 'DESCRIPTION',
        comments: 'TEXT'
    },
    modernCaptures: {
        nodes_id: null,
        owner_id: 7848,
        fn_photo_reference: 'IDENTIFIER',
        f_stop: 55,
        shutter_speed: 55,
        focal_length: 56,
        capture_datetime: '2014-07-09 16:49:00.572006',
        cameras_id: 6,
        lens_id: null,
        lat: 100.1,
        long: 100.1,
        elev: 100.1,
        azimuth: 300,
        comments: 'TEXT',
        alternate: true
    }
}

// Test all defined models
let Model, cookie;

// Test all defined models
Object.keys(mockItems).forEach(modelName => {

    // convert to snake case
    let modelRoute = toSnake(modelName);
    let modelTable = toSnake(modelName);
    let modelLabel = humanize(modelName);
    let testItem;

    /**
     * Load admin data.
     * @private
     */

    let admin = {
        email: process.env.API_EMAIL,
        password: process.env.API_PASS,
        role: 'super_administrator'
    }

    describe(`Test ${modelLabel} CRUD`, () => {

        before(async () => {
            const res = await server
                .post(path.join(BASE_URL, 'login'))
                .set('Accept', 'application/json')
                .send({
                    email: admin.email,
                    password: admin.password
                });
    
            cookie = res.headers["set-cookie"];
        });

        /**
         * Get mock item.
         * @private
         */

        let item = mockItems[modelName];

        it(`Create new ${modelLabel}`, async () => {
            const route = modelRoute === 'surveyors' || modelRoute === 'projects' || modelRoute === 'map_objects'
                    ? path.join('/', modelRoute, 'new')
                    : path.join('/', modelRoute, 'new', item.owner_id);
                    
            const res = await server
                .post(route)
                .set('Accept', 'application/json')
                .set('Cookie', cookie)
                .send(item);

            expect(res).to.have.status(200);
            compare(item, res.body.data);
            testItem = res.body.data;
            // store item id
            item.nodes_id = res.body.item.nodes_id;

        });

        /**
         * Show item data.
         * @private
         */

        it('Show item data', async () => {
            const res = await server
                .get(path.join(BASE_URL, modelRoute, 'show', testItem.nodes_id))
                .set('Accept', 'application/json')
                .send();

            expect(res.status).to.equal(200);
            compare(item, res.body.data);

        });

        /**
         * Update item data.
         * @private
         */

        it('Update item data', async () => {
            const res = await server
                .post(path.join(BASE_URL, modelRoute, 'edit', testItem.nodes_id))
                .set('Accept', 'application/json')
                .send(item);

            expect(res.status).to.equal(200);
            compare(item, res.body.data);

        });

        /**
         * Delete new item.
         * @private
         */

        it('Delete created item', async () => {
            const res = await server
                .post(path.join(BASE_URL, modelRoute, 'remove', testItem.nodes_id))
                .set('Accept', 'application/json')
                .send();

            expect(res).to.have.status(200);
            compare(item, res.body.data);
        });

    });

});
