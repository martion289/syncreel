import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { ClientEventSchema, type ServerEvent } from '@syncreel/shared';
import { isAllowedWsOrigin } from '../auth/tokens.js';
import { resolveRoomParticipant, type AppContext } from '../context.js';

export function registerWsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { room?: string; asGuest?: string; guestToken?: string } }>(
    '/ws',
    { websocket: true },
    (socket: WebSocket, req) => {
      if (!isAllowedWsOrigin(req.headers.origin, ctx.config.publicUrl, req.headers.host)) {
        socket.close(4003, 'Untrusted WebSocket origin');
        return;
      }

      const code = (req.query.room ?? '').trim();
      const room = code ? ctx.roomManager.getRoom(code) : null;
      if (!room) {
        socket.close(4004, 'Room not found');
        return;
      }

      const participant = resolveRoomParticipant(req, ctx, room.code);
      if (!participant) {
        socket.close(4003, 'Authentication required for this room');
        return;
      }

      if (ctx.roomManager.isParticipantKicked(room, participant.id)) {
        socket.close(4008, 'You were removed from this room');
        return;
      }

      ctx.roomManager.attachSocket(room, participant, socket);

      const sendError = (errCode: string, message: string) => {
        const evt: ServerEvent = { type: 'error', code: errCode, message };
        ctx.roomManager.sendToSocket(socket, evt);
      };

      const currentRole = () =>
        ctx.roomManager.getParticipantRole(room, participant.id, participant.role);

      socket.on('message', async (rawData: Buffer | string) => {
        let parsedJson: unknown;
        try {
          const text = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
          parsedJson = JSON.parse(text);
        } catch {
          sendError('BAD_JSON', 'Invalid JSON message');
          return;
        }

        const parsed = ClientEventSchema.safeParse(parsedJson);
        if (!parsed.success) {
          sendError('BAD_EVENT', 'Invalid event payload');
          return;
        }

        const event = parsed.data;
        const role = currentRole();
        room.lastActiveAtMs = Date.now();

        switch (event.type) {
          case 'clock:ping': {
            ctx.roomManager.sendToSocket(socket, {
              type: 'clock:pong',
              clientSendMs: event.clientSendMs,
              serverTimeMs: Date.now()
            });
            break;
          }

          case 'playback:play': {
            const res = room.sync.play(event.positionMs, role, participant.name);
            if (!res.changed && res.reason) {
              sendError('FORBIDDEN', res.reason);
              break;
            }
            if (res.changed) {
              for (const p of room.participants.values()) p.isBuffering = false;
              ctx.roomManager.broadcast(room, { type: 'playback:sync', playback: res.state });
              ctx.roomManager.broadcast(room, {
                type: 'room:participants',
                participants: ctx.roomManager.serializeParticipants(room)
              });
            }
            break;
          }

          case 'playback:pause': {
            const res = room.sync.pause(event.positionMs, role, participant.name);
            if (!res.changed && res.reason) {
              sendError('FORBIDDEN', res.reason);
              break;
            }
            if (res.changed) {
              for (const p of room.participants.values()) p.isBuffering = false;
              ctx.roomManager.broadcast(room, { type: 'playback:sync', playback: res.state });
              ctx.roomManager.broadcast(room, {
                type: 'room:participants',
                participants: ctx.roomManager.serializeParticipants(room)
              });
              if (room.currentMedia) {
                ctx.roomManager.reportAllParticipantsTimeline(
                  room,
                  room.currentMedia,
                  'paused',
                  res.state.anchorPositionMs
                );
              }
            }
            break;
          }

          case 'playback:seek': {
            const res = room.sync.seek(event.positionMs, role, participant.name);
            if (!res.changed && res.reason) {
              sendError('FORBIDDEN', res.reason);
              break;
            }
            if (res.changed) {
              for (const p of room.participants.values()) p.isBuffering = false;
              ctx.roomManager.broadcast(room, { type: 'playback:sync', playback: res.state });
            }
            break;
          }

          case 'playback:skipMarker': {
            const res = room.sync.skipMarker(event.targetPositionMs, role, participant.name);
            if (!res.changed && res.reason) {
              sendError('FORBIDDEN', res.reason);
              break;
            }
            if (res.changed) {
              ctx.roomManager.broadcast(room, { type: 'playback:sync', playback: res.state });
              ctx.roomManager.broadcast(room, {
                type: 'room:notice',
                level: 'info',
                message: `${participant.name} skipped ${event.markerType}`
              });
            }
            break;
          }

          case 'player:buffering': {
            const entry = room.participants.get(participant.id);
            if (entry) entry.isBuffering = event.isBuffering;
            const res = room.sync.setBuffering(participant.id, event.isBuffering);
            if (res.changed) {
              ctx.roomManager.broadcast(room, { type: 'playback:sync', playback: res.state });
            }
            ctx.roomManager.broadcast(room, {
              type: 'room:participants',
              participants: ctx.roomManager.serializeParticipants(room)
            });
            break;
          }

          case 'player:heartbeat': {
            const entry = room.participants.get(participant.id);
            if (entry) entry.driftMs = event.driftMs;
            break;
          }

          case 'player:casting': {
            const entry = room.participants.get(participant.id);
            if (entry) {
              entry.isCasting = event.isCasting;
              ctx.roomManager.broadcast(room, {
                type: 'room:participants',
                participants: ctx.roomManager.serializeParticipants(room)
              });
            }
            break;
          }

          case 'room:setMedia': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can change what is playing');
              break;
            }
            try {
              const plex = ctx.roomManager.getEffectivePlexClient(room);
              const playableKey = plex
                ? await plex.resolvePlayableRatingKey(event.ratingKey)
                : event.ratingKey;
              await ctx.roomManager.setRoomMedia(
                room,
                playableKey,
                participant.name,
                event.startPositionMs
              );
            } catch (err) {
              sendError(
                'MEDIA_ERROR',
                err instanceof Error ? err.message : 'Failed to load Plex media'
              );
            }
            break;
          }

          case 'room:queueAdd': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can queue Plex items');
              break;
            }
            try {
              await ctx.roomManager.addToQueue(room, event.ratingKey, participant.name);
            } catch (err) {
              sendError(
                'QUEUE_ERROR',
                err instanceof Error ? err.message : 'Failed to add to queue'
              );
            }
            break;
          }

          case 'room:queueRemove': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can edit the queue');
              break;
            }
            ctx.roomManager.removeFromQueue(room, event.queueItemId);
            break;
          }

          case 'room:queueNext': {
            if (!room.sync.canControl(role)) {
              sendError('FORBIDDEN', 'Host-only playback control is enabled');
              break;
            }
            try {
              const loaded = await ctx.roomManager.playNextInQueue(room, participant.name);
              if (!loaded) {
                sendError('QUEUE_EMPTY', 'No next title or episode in the queue');
              }
            } catch (err) {
              sendError(
                'MEDIA_ERROR',
                err instanceof Error ? err.message : 'Failed to advance queue'
              );
            }
            break;
          }

          case 'room:updateSettings': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can update room settings');
              break;
            }
            const streamChanged =
              (event.streamMode && event.streamMode !== room.streamMode) ||
              (event.ecoQuality && event.ecoQuality !== room.ecoQuality);

            if (typeof event.hostOnlyControl === 'boolean') {
              room.sync.setHostOnlyControl(event.hostOnlyControl);
            }
            if (typeof event.name === 'string') {
              room.name = event.name;
            }
            if (event.streamMode) {
              room.streamMode = event.streamMode;
            }
            if (event.ecoQuality) {
              room.ecoQuality = event.ecoQuality;
            }
            if (streamChanged) {
              await ctx.streamManager.stopRoomStreams(room.code);
            }
            ctx.roomManager.broadcast(room, {
              type: 'room:settingsUpdated',
              hostOnlyControl: room.sync.getHostOnlyControl(),
              name: room.name,
              streamMode: room.streamMode,
              ecoQuality: room.ecoQuality
            });
            break;
          }

          case 'room:kick': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can remove viewers');
              break;
            }
            ctx.roomManager.kickParticipant(room, participant.id, event.participantId);
            break;
          }

          case 'room:mute': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can mute viewers');
              break;
            }
            ctx.roomManager.muteParticipant(room, event.participantId, event.muted);
            break;
          }

          case 'room:transferHost': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can transfer host privileges');
              break;
            }
            ctx.roomManager.transferHost(room, participant.id, event.participantId);
            break;
          }

          case 'room:notifyWebhook': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can send webhook alerts');
              break;
            }
            const whRes = await ctx.roomManager.notifyWebhook(room, participant.name);
            ctx.roomManager.sendToSocket(socket, {
              type: 'room:notice',
              level: whRes.ok ? 'info' : 'warning',
              message: whRes.ok
                ? 'Sent room invite notification to webhook'
                : whRes.error || 'Webhook failed'
            });
            break;
          }

          case 'poll:start': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can start a movie poll');
              break;
            }
            try {
              await ctx.roomManager.startPoll(room, event.ratingKeys, participant.name);
            } catch (err) {
              sendError('POLL_ERROR', err instanceof Error ? err.message : 'Failed to start poll');
            }
            break;
          }

          case 'poll:vote': {
            ctx.roomManager.votePoll(room, participant.id, event.ratingKey);
            break;
          }

          case 'poll:close': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can close the poll');
              break;
            }
            await ctx.roomManager.closePoll(room, participant.name, event.autoPlayWinner ?? true);
            break;
          }

          case 'ready:start': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can start a ready check');
              break;
            }
            ctx.roomManager.startReadyCheck(room, participant.name);
            break;
          }

          case 'ready:ack': {
            ctx.roomManager.ackReady(room, participant.id, event.ready);
            break;
          }

          case 'ready:launchNow': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can launch playback early');
              break;
            }
            ctx.roomManager.launchReadyCountdown(room, participant.name);
            break;
          }

          case 'ready:cancel': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can cancel ready check');
              break;
            }
            ctx.roomManager.cancelReadyCheck(room, true);
            break;
          }

          case 'swipe:start': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can start Swipe Match');
              break;
            }
            try {
              await ctx.roomManager.startSwipeMatch(room, event.config, participant.name);
            } catch (err) {
              sendError(
                'SWIPE_ERROR',
                err instanceof Error ? err.message : 'Failed to create swipe deck'
              );
            }
            break;
          }

          case 'swipe:vote': {
            ctx.roomManager.recordSwipeVote(room, participant.id, event.ratingKey, event.decision);
            break;
          }

          case 'swipe:close': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can close Swipe Match');
              break;
            }
            ctx.roomManager.closeSwipeMatch(room);
            break;
          }

          case 'swipe:playMatch': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can launch a matched title');
              break;
            }
            try {
              await ctx.roomManager.playSwipeMatchItem(room, event.ratingKey, participant.name);
            } catch (err) {
              sendError(
                'MEDIA_ERROR',
                err instanceof Error ? err.message : 'Failed to load matched title'
              );
            }
            break;
          }

          case 'swipe:queueMatch': {
            if (role !== 'host') {
              sendError('FORBIDDEN', 'Only the host can queue a matched title');
              break;
            }
            try {
              await ctx.roomManager.addToQueue(room, event.ratingKey, participant.name);
              ctx.roomManager.broadcast(room, {
                type: 'room:notice',
                level: 'info',
                message: `Added matched pick to Up Next`
              });
            } catch (err) {
              sendError(
                'QUEUE_ERROR',
                err instanceof Error ? err.message : 'Failed to queue matched title'
              );
            }
            break;
          }

          case 'chat:send': {
            const entry = room.participants.get(participant.id);
            if (entry?.isMuted) {
              sendError('MUTED', 'You are currently muted in chat by the host');
              break;
            }
            ctx.roomManager.pushChatMessage(room, {
              id: crypto.randomUUID(),
              participantId: participant.id,
              participantName: participant.name,
              role,
              text: event.text,
              createdAtMs: Date.now()
            });
            break;
          }

          case 'chat:react': {
            ctx.roomManager.broadcast(room, {
              type: 'chat:reaction',
              id: crypto.randomUUID(),
              emoji: event.emoji,
              participantId: participant.id,
              participantName: participant.name
            });
            break;
          }
        }
      });

      socket.on('close', () => {
        ctx.roomManager.detachSocket(room, participant.id, socket);
      });
    }
  );
}
