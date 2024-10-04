/*!
 * MLP.API.Controllers.Users
 * File: users.controller.js
 * Copyright(c) 2021 Runtime Software Development Inc.
 * MIT Licensed
 */

/**
 * Module dependencies.
 * @private
 */

import * as auth from '../services/auth.services.js';
import valid from '../lib/validate.utils.js';
import { prepare } from '../lib/api.utils.js';
import { getRoleData } from '../services/users.services.js';

/**
 * Controller initialization.
 *
 * @src public
 */

let roleLabels = {};

export const init = async () => {
    // get designated role labels
    roleLabels = await getRoleData();
};

/**
 * User sign-in using email and password.
 *
 * @param req
 * @param res
 * @param {Function} next
 * @method post
 * @src public
 */

export const login = async (req, res, next) => {

    // get access token from request cookie
    const { access_token=null } = req.signedCookies || [];

    let credentials;
    try {
        // check if user is currently logged-in
        const isAuth = await auth.validate(access_token);
        if (isAuth) return next(new Error('redundantLogin'));

        // otherwise, validate user credentials
        const { email = '', password = '' } = req.body || {};

        credentials = {
            email: valid.load(email).isEmail().data,
            password: valid.load(password).isPassword().data,
        }
    }
    catch (err) {
        return next(err);
    }

    // authenticate credentials against Keycloak
    await auth.authenticate(credentials)
        .then(data => {

            // get token value
            const { refresh_token=null, access_token=null } = data || {};

            // send access token to the client inside a cookie
            res.cookie("access_token", access_token, {httpOnly: true, sameSite: 'strict', signed: true, secure: true});
            res.cookie("refresh_token", refresh_token, {httpOnly: true, sameSite: 'strict', signed: true, secure: true});

            // get user role label
            const role = data.roles.length > 0
                ? roleLabels.find(r => r.name === data.roles[0])
                : 'Registered';

            // successful login
            res.status(200).json(
                prepare({
                    message: {msg: 'Login successful!', type: 'success'},
                    view: 'login',
                    user: {
                        email: credentials.email,
                        role: data.roles,
                        label: role.label || 'Registered'
                    }})
            );
        })
        .catch(err => {return next(err)});

};


/**
 * User sign-out.
 *
 * @param req
 * @param res
 * @param {Function} next
 * @method post
 * @src public
 */

export const logout = async (req, res, next) => {

    // get access token from cookie
    const { access_token=null, refresh_token=null } = req.signedCookies || [];

    // logout session in Keycloak
    await auth.logout(access_token, refresh_token)
        .then(kcRes => {

            // Keycloak did not properly log out user
            if (kcRes.status !== 204)
                throw Error('logoutFailed');

            // successful session logout
            res.cookie("access_token", access_token, {httpOnly: true, sameSite: 'strict', signed: true, maxAge: 0, secure: true});
            res.cookie("refresh_token", refresh_token, {httpOnly: true, sameSite: 'strict', signed: true, maxAge: 0, secure: true});
            res.status(200).json(
                prepare({
                    message: {msg: 'Successfully logged out!', type: 'success'}
                })
            );
        })
        .catch(err => {return next(err)});

};

/**
 * Refresh user token.
 *
 * @param req
 * @param res
 * @param {Function} next
 * @method get
 * @src public
 */

export const refresh = async (req, res, next) => {

    // refresh token (Keycloak API)
    await auth.refresh(req)
        .then(data => {
            // reset tokens if a token is not found or is invalid
            if (!data) {
                res.cookie("access_token", '', {httpOnly: true, sameSite: 'strict', signed: true, maxAge: 0, secure: true});
                res.cookie("refresh_token", '', {httpOnly: true, sameSite: 'strict', signed: true, maxAge: 0, secure: true});
                return res.status(200).json(
                    prepare({
                        message: {msg: 'Token reset.', type: 'success'}
                    })
                );
            }

            // store new access token inside an http-only cookie
            // TODO: include secure: true on production site
            const { access_token=null, refresh_token=null } = data || {};
            res.cookie("access_token", access_token, {httpOnly: true, sameSite: 'strict', signed: true});
            res.cookie("refresh_token", refresh_token, {httpOnly: true, sameSite: 'strict', signed: true});

            // get user role label
            const role = data.roles.length > 0
                ? roleLabels.find(r => r.name === data.roles[0])
                : 'Administrator';

            // successful token refresh
            res.status(200).json(
                prepare({
                    message: {msg: 'Token refreshed.', type: 'success'},
                    user: {
                        email: data.email,
                        role: data.roles,
                        label: role.label
                    }
                })
            );
        })
        .catch(err => {return next(err)});
};
