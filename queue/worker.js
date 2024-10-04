#!/usr/bin/env node

/*!
 * MLE.QUEUE
 * File: worker.js
 * Copyright(c) 2024 Runtime Software Development Inc.
 * Version 2.0
 * MIT Licensed
 *
 * ----------
 * Description
 *
 * File processing queue API.
 *
 * ---------
 * Revisions
 * - 29-07-2023   Refactored out Redis connection as separate queue service.
 */

'use strict';

import express from 'express';
import Queue from 'bull';
import { processJob, addQueueJob } from "./worker.services.js";

/**
 * Create Queue API application.
 * @private
 */

/**
 * Initialize main Express instance.
 */

const app = express();

/**
 * Get port from environment and store in Express
 */

const host = process.env.QUEUE_HOST;
const port = process.env.QUEUE_PORT;

// set queue port
app.set('port', port);

app.get('/', (_, res) => {
    res.send('No Access')
})

app.listen(port, () => {
    console.log(`Queue listening on ${host}:${port}`);
    console.log('\n- (Node) Exposed Garbage Collection:', !!global.gc);
});

/**
 * Connect to Redis message broker
 * - allows files to be queued for processing
 * @private
 */

try {
    let queue = new Queue('imageProcessor', {
        redis: {
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT,
        },
    });

    // Connect to Redis Queue and process jobs
    queue.on('process', (job) => {
        // Emit an event to notify the React app
        io.emit('job:update', { jobId: job.id, state: 'processing' });
    });
    // Listen for completed jobs
    queue.on('completed', (job) => {
        io.emit('job:update', { jobId: job.id, state: 'completed' });
    });

    // Listen for failed jobs
    queue.on('failed', (job) => {
        io.emit('job:update', { jobId: job.id, state: 'failed' });
    });

    queue.on('process', (job) => {
        redisClient.publish('job:updates', JSON.stringify({ jobId: job.id, state: 'processing' }));
      });
      
      queue.on('completed', (job) => {
        redisClient.publish('job:updates', JSON.stringify({ jobId: job.id, state: 'completed' }));
      });
      
      queue.on('failed', (job) => {
        redisClient.publish('job:updates', JSON.stringify({ jobId: job.id, state: 'failed' }));
      });

    // Connect to Redis Queue and process jobs
    queue.process(async (job) => {

        try {
            const { data } = job || {};
            console.log(`Job ${job.id} [PENDING]; Uploading File: ${data.src}\n`);
            const { src } = await processJob(job, console.error);
            await addQueueJob(null, job);
            console.log(`Job ${job.id} [COMPLETED]; Uploading File: ${src}\n`);

        } catch (error) {
            console.error('Error processing job:', error);
            await addQueueJob(error, job);
        } finally {
            // force garbage collection to prevent heap memory leaks
            if (global.gc) {
                console.log('Forcing garbage collection...');
                global.gc();
                console.log('Garbage collection forced.');
            } else {
                console.log('Garbage collection is not exposed.');
            }
        }
    });
}
catch (err) {
    console.error(err);
}