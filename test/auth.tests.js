/*!
 * MLP.API.Tests.Users
 * File: users.test.js
 * Copyright(c) 2024 Runtime Software Development Inc.
 * MIT Licensed
 * 
 * Description: Run all user unit tests (authentication required)
 * 
 * Revisisons
 * 2024-09-20: Initial release
 */

/**
 * Module dependencies.
 * @private
 */

import { server, BASE_URL } from './setup.js';
import { expect } from 'chai';
import { it, describe } from 'mocha';
import { errors } from '../src/error.js';
import path from 'path';

/**
 * Get admin user data.
 * */

let admin = {
    email: process.env.API_EMAIL,
    password: process.env.API_PASS,
    role: 'super_administrator'
}

// cookie to store user access and refresh tokens
let cookie;

/**
 * Sign-in administrator.
 * @private
 */

describe('Login Administrator', () => {
    it('Authenticate wrong email should fail', async () => {
        const res = await server
            .post(path.join(BASE_URL, 'login'))
            .set('Accept', 'application/json')
            .send({
                email: 'wrong@example.ca',
                password: admin.password
            });
        expect(res).to.have.status(422);
        expect(res.body.message.msg).to.equal(errors.invalidCredentials.msg);
    });

    it('Authenticate wrong password should fail', async () => {
        const res = await server
            .post(path.join(BASE_URL, 'login'))
            .set('Accept', 'application/json')
            .send({
                email: admin.email,
                password: 'WRONG5565lSSR!3323'
            });
        expect(res).to.have.status(422);
        expect(res.body.message.msg).to.equal(errors.invalidCredentials.msg);
    });

    it('Authenticate correct credentials', async () => {
        const res = await server
            .post(path.join(BASE_URL, 'login'))
            .set('Accept', 'application/json')
            .send({
                email: admin.email,
                password: admin.password
            });

        // store access/refresh tokens
        cookie = res.headers["set-cookie"];
        expect(res).to.have.status(200);
        expect(res.body.message.msg).to.equal('Login successful!');

    });

    it('Redundant login', async () => {
        const res = await server
            .post(path.join(BASE_URL, 'login'))
            .set('Accept', 'application/json')
            .set('Cookie', cookie)
            .send({
                email: admin.email,
                password: admin.password
            });
        expect(res).to.have.status(422);
        expect(res.body.message.msg).to.equal(errors.redundantLogin.msg);

    });

    it('Should refresh token', async () => {
        const res = await server
            .post(path.join(BASE_URL, 'refresh'))
            .set('Accept', 'application/json')
            .set('Cookie', cookie)
            .send();

        expect(res).to.have.status(200);
        expect(res.body.message.msg).to.equal('Token refreshed.');

    });

    it('Should logout user', async () => {
        const res = await server
            .post(path.join(BASE_URL, 'logout'))
            .set('Accept', 'application/json')
            .set('Cookie', cookie[0])
            .send();

        expect(res).to.have.status(200);
        expect(res.body.message.msg).to.equal('Successfully logged out!');

    });
});
