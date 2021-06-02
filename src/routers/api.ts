// Copyright © 2021 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Router } from 'express';
import * as blobsHandler from '../handlers/blobs';
import * as messagesHandler from '../handlers/messages';
import * as utils from '../lib/utils';
import RequestError from '../lib/request-error';
import { config, persistConfig } from '../lib/config';
import { IStatus } from '../lib/interfaces';
import https from 'https';
import { key, cert, ca, loadCAs } from '../lib/cert';
import * as eventsHandler from '../handlers/events';
import { promises as fs } from 'fs';
import path from 'path';

export const router = Router();

router.get('/status', async (_req, res, next) => {
  try {
    let status: IStatus = {
      messageQueueSize: eventsHandler.getQueueSize(),
      peers: []
    };
    let promises = [];
    const httpsAgent = new https.Agent({ cert, key, ca });
    for (const peer of config.peers) {
      promises.push(utils.axiosWithRetry({
        method: 'head',
        url: `${peer.endpoint}/api/v1/ping`,
        httpsAgent
      }));
    }
    const responses = await (Promise as any).allSettled(promises);
    let i = 0;
    for (const peer of config.peers) {
      status.peers.push({
        name: peer.name,
        available: responses[i++].status === 'fulfilled'
      })
    }
    res.send(status);
  } catch (err) {
    next(err);
  }
});

router.get('/peers', (_req, res) => {
  res.send(config.peers);
});

router.put('/peers/:name', async (req, res, next) => {
  try {
    if (req.body.endpoint === undefined) {
      throw new RequestError('Missing endpoint', 400);
    }
    if (req.body.certificate !== undefined) {
      await fs.writeFile(path.join(utils.constants.DATA_DIRECTORY, utils.constants.PEER_CERTS_SUBDIRECTORY, `${req.params.name}.pem`), req.body.certificate);
    }
    let peer = config.peers.find(peer => peer.name === req.params.name);
    if (peer === undefined) {
      peer = {
        name: req.params.name,
        endpoint: req.body.endpoint
      };
      config.peers.push(peer);
    }
    await persistConfig();
    await loadCAs();
    res.send({ status: 'added' });
  } catch (err) {
    next(err);
  }
});

router.delete('/peers/:name', async (req, res, next) => {
  try {
    if (!config.peers.some(peer => peer.name === req.params.name)) {
      throw new RequestError('Peer not found', 404);
    }
    try {
      await fs.rm(path.join(utils.constants.DATA_DIRECTORY, utils.constants.PEER_CERTS_SUBDIRECTORY, `${req.params.name}.pem`));
    } catch (err) {
      if (err.errno !== -2) {
        throw new RequestError(`Failed to remove peer certificate`);
      }
    }
    config.peers = config.peers.filter(peer => peer.name !== req.params.name);
    await persistConfig();
    await loadCAs();
    res.send({ status: 'removed' });
  } catch (err) {
    next(err);
  }
});

router.post('/messages', async (req, res, next) => {
  try {
    if (req.body.message === undefined) {
      throw new RequestError('Missing message', 400);
    }
    if (req.body.recipient === undefined) {
      throw new RequestError('Missing recipient', 400);
    }
    let recipientURL = config.peers.find(peer => peer.name === req.body.recipient)?.endpoint;
    if (recipientURL === undefined) {
      throw new RequestError(`Unknown recipient`, 400);
    }
    let requestID: string | undefined = undefined;
    if(typeof req.body.requestID === 'string') {
      requestID = req.body.requestID;
    }
    messagesHandler.sendMessage(req.body.message, req.body.recipient, recipientURL, requestID);
    res.send({ status: 'submitted' });
  } catch (err) {
    next(err);
  }
});

router.get('/blobs/*', async (req, res, next) => {
  try {
    const blobPath = `/${req.params[0]}`;
    if (!utils.regexp.FILE_KEY.test(blobPath) || utils.regexp.CONSECUTIVE_DOTS.test(blobPath)) {
      throw new RequestError('Invalid path', 400);
    }
    let blobStream = await blobsHandler.retreiveBlob(blobPath);
    blobStream.on('end', () => res.end());
    blobStream.pipe(res);
  } catch (err) {
    next(err);
  }
});

router.put('/blobs/*', async (req, res, next) => {
  try {
    const blobPath = `/${req.params[0]}`;
    if (!utils.regexp.FILE_KEY.test(blobPath) || utils.regexp.CONSECUTIVE_DOTS.test(blobPath)) {
      throw new RequestError('Invalid path', 400);
    }
    const file = await utils.extractFileFromMultipartForm(req);
    const hash = await blobsHandler.storeBlob(file, blobPath);
    res.send({ hash });
  } catch (err) {
    next(err);
  }
});

router.post('/transfers', async (req, res, next) => {
  try {
    if (req.body.path === undefined) {
      throw new RequestError('Missing path', 400);
    }
    if (!utils.regexp.FILE_KEY.test(req.body.path) || utils.regexp.CONSECUTIVE_DOTS.test(req.body.path)) {
      throw new RequestError('Invalid path', 400);
    }
    if (req.body.recipient === undefined) {
      throw new RequestError('Missing recipient', 400);
    }
    let recipientURL = config.peers.find(peer => peer.name === req.body.recipient)?.endpoint;
    if (recipientURL === undefined) {
      throw new RequestError(`Unknown recipient`, 400);
    }
    let requestID: string | undefined = undefined;
    if(typeof req.body.requestID === 'string') {
      requestID = req.body.requestID;
    }
    blobsHandler.sendBlob(req.body.path, req.body.recipient, recipientURL, requestID);
    res.send({ status: 'submitted' });
  } catch (err) {
    next(err);
  }
});
