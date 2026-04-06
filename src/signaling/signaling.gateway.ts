import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class SignalingGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // =========================
  // JOIN ROOM
  // =========================
  @SubscribeMessage('join-room')
  handleJoin(
    @MessageBody()
    data: {
      roomId: string;
      userName: string;
      isAdmin?: boolean;
      mode?: 'audio' | 'video';
    },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, userName, isAdmin, mode } = data;
    client.join(roomId);

    // Store metadata on socket
    (client as any).roomId = roomId;
    (client as any).userName = userName;
    (client as any).isAdmin = !!isAdmin;
    (client as any).mode = mode || 'video';

    console.log(`✅ ${userName} joined ${roomId} (${mode ?? 'video'}) | admin=${!!isAdmin}`);

    // Notify other users in the room
    client.to(roomId).emit('user-joined', {
      socketId: client.id,
      userName,
      isAdmin,
      mode,
    });

    // Check room size
    const room = this.server.sockets.adapter.rooms.get(roomId);
    if (room && room.size === 2) {
      console.log(`🔥 Room ${roomId} ready (2 users)`);
      this.server.to(roomId).emit('ready');
    }
  }

  // =========================
  // CHAT MESSAGE
  // =========================
  @SubscribeMessage('chat-message')
  handleChat(
    @MessageBody()
    data: { roomId: string; text: string; userName: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, text, userName } = data;
    client.to(roomId).emit('chat-message', { text, userName });
    console.log(`💬 ${userName}: ${text}`);
  }

  // =========================
  // OFFER
  // =========================
  @SubscribeMessage('offer')
  handleOffer(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    client.to(data.roomId).emit('offer', data);
  }

  // =========================
  // ANSWER
  // =========================
  @SubscribeMessage('answer')
  handleAnswer(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    client.to(data.roomId).emit('answer', data);
  }

  // =========================
  // ICE CANDIDATE
  // =========================
  @SubscribeMessage('ice-candidate')
  handleIce(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    client.to(data.roomId).emit('ice-candidate', data);
  }

  // =========================
  // MIC TOGGLE
  // =========================
  @SubscribeMessage('toggle-mic')
  handleMicToggle(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.roomId).emit('toggle-mic', data);
  }

  // =========================
  // HAND RAISE
  // =========================
  @SubscribeMessage('hand-raised')
  handleHandRaise(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.roomId).emit('hand-raised', {
      userName: (client as any).userName,
    });
  }

  // =========================
  // CAMERA SWITCH (FIXED)
  // =========================
  /**
   * FIX 1: Only emit 'switch-camera' to the NON-ADMIN socket in the room.
   *         Previously: client.to(roomId) emits to ALL others — but since
   *         it's a 2-person room, that's fine. HOWEVER the real issue was
   *         that the admin's own client also received the event because
   *         the frontend was not filtering properly. Now we find the guest
   *         socket explicitly and emit only to them.
   *
   * FIX 2: Added 'camera-flip-result' handler so the guest's result
   *         (success/failure) is forwarded back to the admin socket.
   */
  @SubscribeMessage('switch-camera')
  handleSwitchCamera(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    const roomId = data?.roomId ?? (client as any).roomId;
    const senderIsAdmin = !!(data?.isAdmin ?? (client as any).isAdmin);

    console.log(
      `📷 switch-camera received from ${(client as any).userName} | isAdmin=${senderIsAdmin} | room=${roomId}`,
    );

    if (!senderIsAdmin) {
      // Guard: only admins should be sending this event
      console.warn(
        `⚠️  Non-admin ${(client as any).userName} tried to switch camera — ignored`,
      );
      return;
    }

    // Find the guest socket (the only other socket in the room that is NOT admin)
    const room = this.server.sockets.adapter.rooms.get(roomId);
    if (!room) {
      console.warn(`⚠️  Room ${roomId} not found`);
      return;
    }

    let guestSocketId: string | null = null;
    for (const sid of room) {
      if (sid === client.id) continue; // skip the sender (admin)
      const sock = this.server.sockets.sockets.get(sid);
      if (sock && !(sock as any).isAdmin) {
        guestSocketId = sid;
        break;
      }
    }

    if (!guestSocketId) {
      console.warn(`⚠️  No guest found in room ${roomId} to flip camera`);
      return;
    }

    console.log(`📷 Sending switch-camera to guest socket ${guestSocketId}`);
    // Emit ONLY to the guest — not to the whole room, not back to admin
    this.server.to(guestSocketId).emit('switch-camera', {
      fromAdmin: true,
      roomId,
    });
  }

  // =========================
  // CAMERA FLIP RESULT (NEW)
  // =========================
  /**
   * Guest emits this after attempting the camera flip.
   * We forward it back to the admin so they can see success/failure in their log panel.
   */
  @SubscribeMessage('camera-flip-result')
  handleCameraFlipResult(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    const roomId = data?.roomId ?? (client as any).roomId;

    console.log(
      `📷 camera-flip-result from ${(client as any).userName} | success=${data?.success} | facingMode=${data?.facingMode ?? 'n/a'} | room=${roomId}`,
    );

    // Find the admin socket in the room and send the result to them only
    const room = this.server.sockets.adapter.rooms.get(roomId);
    if (!room) return;

    for (const sid of room) {
      if (sid === client.id) continue; // don't echo back to sender
      const sock = this.server.sockets.sockets.get(sid);
      if (sock && (sock as any).isAdmin) {
        this.server.to(sid).emit('camera-flip-result', {
          success: data?.success,
          facingMode: data?.facingMode,
          error: data?.error,
        });
        console.log(`📷 Forwarded camera-flip-result to admin socket ${sid}`);
        break;
      }
    }
  }

  // =========================
  // DISCONNECT
  // =========================
  handleDisconnect(client: Socket) {
    const roomId = (client as any).roomId;
    const userName = (client as any).userName;
    if (roomId) {
      client.to(roomId).emit('user-left', {
        userName: userName || 'User',
      });
      console.log(`❌ ${userName} left room ${roomId}`);
    }
  }
}