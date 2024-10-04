/*!
 * MLP.API.Tests.Main
 * File: main.test.js
 * Copyright(c) 2021 Runtime Software Development Inc.
 * MIT Licensed
 */

/**
 * Module dependencies.
 * @private
 */

import { server, BASE_URL } from './setup.js';
import { expect } from 'chai';
import { describe, it } from 'mocha';

/**
 * Test index page
 * @private
 */

describe('Index page test', () => {
  it('Gets base url', async () => {
    const res = await server.get(BASE_URL);
    expect(res.status).to.equal(200);
  });
});

