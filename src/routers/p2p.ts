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

import { Router, Request } from 'express';
import * as utils from '../lib/utils';
import * as blobsHandler from '../handlers/blobs';
import path from 'path';
import { EventEmitter } from 'events';
import { IBlobReceivedEvent, IMessageReceivedEvent } from '../lib/interfaces';
import { v4 as uuidV4 } from 'uuid';

export const router = Router();
export const eventEmitter = new EventEmitter();

router.head('/ping', (_req, res) => {
  res.sendStatus(204);
});

router.post('/messages', async (req: Request, res, next) => {
  try {
    const sender = utils.extractPeerSenderFromRequest(req);
    const message = await utils.extractMessageFromMultipartForm(req);
    eventEmitter.emit('event', {
      id: uuidV4(),
      type: 'message-received',
      sender,
      message
    } as IMessageReceivedEvent);
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

router.put('/blobs/*', async (req: Request, res, next) => {
  try {
    const sender = utils.extractPeerSenderFromRequest(req);
    const file = await utils.extractFileFromMultipartForm(req);
    const blobPath = path.join(utils.constants.RECEIVED_BLOBS_SUBDIRECTORY, sender, req.params[0]);
    const metadata = await blobsHandler.storeBlob(file, blobPath);
    res.sendStatus(204);
    eventEmitter.emit('event', {
      id: uuidV4(),
      type: 'blob-received',
      sender,
      path: blobPath,
      hash: metadata.hash,
      size: metadata.size,
      lastUpdate: metadata.lastUpdate
    } as IBlobReceivedEvent);
  } catch (err) {
    next(err);
  }
});
