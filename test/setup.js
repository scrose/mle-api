/*!
 * MLP.API.Tests.Setup
 * File: setup.js
 * Copyright(c) 2021 Runtime Software Development Inc.
 * MIT Licensed
 */

/**
 * Module dependencies.
 * @private
 */


import createApp from '../src/app.js';
import { use, expect } from 'chai';
import sinonChai from 'sinon-chai';
import chaiHttp from "chai-http";

/**
 * HTTP integration testing with Chai assertions.
 * See: https://www.chaijs.com
 */

const chai = use(chaiHttp);
use(sinonChai);

/**
 * Create new Express app and server server.
 * @private
 */

let app, server;

before(async () => {
    // set environment to test
    process.env.NODE_ENV = 'test';
    app = await createApp();
    server = chai.request.agent(app);
});

/**
 * Compares output data to model schema
 * @param {Object} model
 * @param {Array} data
 * @private
 */

export function compare(model, data) {
    data.forEach((item) => {
        // go through model properties
        Object.entries(model.attributes)
            .forEach(([field, _]) => {
                expect(item).to.have.property(field);
            });
    });
}

// export global test variables  
export { server };
export const BASE_URL = '/';
