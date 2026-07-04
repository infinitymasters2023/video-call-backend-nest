import { Body, Controller, HttpStatus, Post, HttpCode, UsePipes, ValidationPipe, Get, Param, Query, Headers } from '@nestjs/common';
import { randomUUID } from 'crypto';

import {
  ApiTags,
} from '@nestjs/swagger';
import { PersonInfoService } from './personinfo.service';
import { GetServiceCallDTO, SendCustomInviteDTO, SendMeetingDTO, TestWhatsappDto } from './personinfo.dtos';
import { HelperService } from 'src/helper/helper.service';
import { WhatsappService } from 'src/helper/whatsapp.service';
import { MeetingSchedulerService } from './meeting-scheduler.service';
import { AuthService } from 'src/auth/auth.service';



@ApiTags('person-info')
@Controller('person-info')
export class PersonInfoController {
  constructor(
    private readonly personInfoService: PersonInfoService,
    private readonly helperService: HelperService,
    private readonly whatsappService: WhatsappService,
    private readonly meetingSchedulerService: MeetingSchedulerService,
    private readonly authService: AuthService,
  ) { }


  @Post('/service_call_info')
  async serviceCallInfo(
    @Body() dto: GetServiceCallDTO,
  ) {

    return await this.personInfoService.serviceCallInfo(dto);
  }
  @Post('/send_meeting_link')
  async sendMeetingLink(
    @Body() sendMeetingDto: SendMeetingDTO,
  ) {
    if (sendMeetingDto.scheduleAt) {
      const runAt = new Date(sendMeetingDto.scheduleAt);

      if (Number.isNaN(runAt.getTime())) {
        return {
          statusCode: 400,
          isSuccess: false,
          message: 'Invalid scheduleAt datetime',
          data: null,
        };
      }

      if (runAt.getTime() <= Date.now()) {
        return {
          statusCode: 400,
          isSuccess: false,
          message: 'scheduleAt must be a future datetime',
          data: null,
        };
      }

      const scheduled = this.meetingSchedulerService.scheduleMeeting(
        runAt,
        async () => this.dispatchMeetingLink(sendMeetingDto),
      );

      return {
        statusCode: 202,
        isSuccess: true,
        message: 'Meeting link send scheduled successfully',
        data: scheduled,
      };
    }

    return this.dispatchMeetingLink(sendMeetingDto);
  }

  @Get('/meeting_schedule/:scheduleId')
  async getMeetingScheduleStatus(
    @Param('scheduleId') scheduleId: string,
  ) {
    const job = this.meetingSchedulerService.getJobStatus(scheduleId);

    if (!job) {
      return {
        statusCode: 404,
        isSuccess: false,
        message: 'Scheduled meeting not found',
        data: null,
      };
    }

    return {
      statusCode: 200,
      isSuccess: true,
      message: 'Scheduled meeting fetched successfully',
      data: job,
    };
  }

  private async dispatchMeetingLink(
    sendMeetingDto: SendMeetingDTO,
  ) {
    const {
      meetingLink,
      quNumber,
      ...otherData
    } = sendMeetingDto;

    // =========================
    // GET COMMON DATA
    // =========================

    const commonInfo =
      await this.personInfoService.getMeetingClaimUserInfo(
        quNumber ?? '',
        sendMeetingDto.userEmail ?? '',
        sendMeetingDto.userMobile ?? '',
      );

    const claimInfo = commonInfo?.data;

    if (!claimInfo) {

      return {
        statusCode: 404,
        isSuccess: false,
        message: 'Claim/User info not found',
        data: null,
      };
    }

    // =========================
    // GET EMAILS & MOBILES
    // =========================

    const sendTo = Object.values(otherData)
      .flat()
      .filter(value => value !== '');

    const { emails, mobiles } =
      await this.helperService.textEmailOrMobiles(sendTo);

    const resInputData: {
      type: string;
      isSuccess: any;
    }[] = [];

    // =========================
    // EMAIL SENDING
    // =========================

    if (emails && emails.length > 0) {

      const subject =
        `Video Call for Processing Claim - Ticket ${claimInfo.TicketNO} , Loan No ${claimInfo.LoanNo} , Product ${claimInfo.productName}, Brand ${claimInfo.brand}`;

      const data = { name: 'Customer' };

      await Promise.all(
        emails.map(async (email) => {

          const updatedMeetingLink =
            (email === sendMeetingDto.userEmail)
              ? `${meetingLink}?qu=${quNumber}&userid=${claimInfo.userid}&mode=AGENT`
              : meetingLink;

          const template = `
        <div dir="ltr">

        <p>
          Dear Customer,
        </p>

        <p>
          This refers to your Claim -
          Ticket <strong>${claimInfo.TicketNO}</strong>
          Loan <strong>${claimInfo.LoanNo}</strong>.
          Customer Name <strong>${claimInfo.customername}</strong>
          Product <strong>${claimInfo.productName}</strong>
          Brand <strong>${claimInfo.brand}</strong>.
        </p>

        <p>
          You are requested to join the Video Meeting
          via the weblink below:
        </p>

        <p>
          📍 Meeting Link:
          <a href="${updatedMeetingLink}">
            Click Here
          </a>
        </p>

        <p>
          Regards<br>
          ${sendMeetingDto.participantName}<br>
          Customer Service Executive<br>
          Infinity Assurance Solutions Pvt. Ltd.
        </p>

        </div>
        `;

          const emailRes =
            await this.helperService.sendEmail(
              template,
              data,
              email,
              subject,
            );

          resInputData.push({
            type: email,
            isSuccess: emailRes,
          });
        }),
      );
    }

    // =========================
    // SMS & WHATSAPP
    // =========================

    if (mobiles && mobiles.length > 0) {

      await Promise.all(
        mobiles.map(async (mobile) => {

          const mobileMeetingLink =
            (mobile === sendMeetingDto.userMobile)
              ? `${meetingLink}?qu=${quNumber}&userid=${claimInfo.userid}&mode=AGENT`
              : meetingLink;

          const part1 =
            `Ticket No. ${claimInfo.TicketNO}`;

          const part2 =
            mobileMeetingLink;

          const part3 =
            '123456';

          const part4 =
            'Customer Care';

          const part5 =
            '8447882424';

          const part6 =
            'between 9AM-6PM Mon-Sat excluding holidays';

          const message =
            `Hi, Pls Join VIDEO CALL ${part1} via link ${part2} ${part3}. Call Infinity ${part4} ${part5} ${part6}`;

          console.log('Sending SMS to:', mobile);

          console.log('Generated message:', message);

          const mobileRes =
            await this.helperService.sendSms(
              mobile,
              message,
              '1107170365802623901',
            );

          resInputData.push({
            type: mobile,
            isSuccess: mobileRes,
          });

          try {
            console.log('======================');
            console.log('Calling WhatsApp API');
            console.log('Mobile =>', mobile);
            console.log('Meeting Link =>', mobileMeetingLink);
            console.log('======================');
            const whatsappRes =
              await this.whatsappService.sendMeetingLink(
                mobile,
                mobileMeetingLink ?? '',
              );
            console.log('WhatsApp Response =>', whatsappRes);
            resInputData.push({
              type: `whatsapp:${mobile}`,
              isSuccess: whatsappRes,
            });
          } catch (error) {
            resInputData.push({
              type: `whatsapp:${mobile}`,
              isSuccess: error,
            });
          }
        }),
      );
    }

    return {
      statusCode: 200,
      isSuccess: true,
      message: 'InfyMeet link sent successfully',
      data: resInputData,
    };
  }
  // =========================
  // CUSTOM EMAIL INVITE (no ticket / claim required)
  // =========================
  @Post('/send_custom_invite')
  async sendCustomInvite(
    @Body() dto: SendCustomInviteDTO,
  ) {
    // The organizer's host link is always sent immediately (even when the
    // invitee emails are scheduled for later) so they can save / start it now.
    let hostEmailSent = false;
    if (dto.hostEmail && dto.hostLink) {
      try {
        const r = await this.dispatchHostEmail(dto);
        hostEmailSent = !!r;
      } catch {
        hostEmailSent = false;
      }
    }

    if (dto.scheduleAt) {
      const runAt = new Date(dto.scheduleAt);

      if (Number.isNaN(runAt.getTime())) {
        return {
          statusCode: 400,
          isSuccess: false,
          message: 'Invalid scheduleAt datetime',
          data: null,
        };
      }

      if (runAt.getTime() <= Date.now()) {
        return {
          statusCode: 400,
          isSuccess: false,
          message: 'scheduleAt must be a future datetime',
          data: null,
        };
      }

      const scheduled = this.meetingSchedulerService.scheduleMeeting(
        runAt,
        async () => this.dispatchCustomInvite(dto),
      );

      return {
        statusCode: 202,
        isSuccess: true,
        message: hostEmailSent
          ? 'Meeting scheduled — invites queued and host link emailed to you'
          : 'Invite email scheduled successfully',
        data: { ...scheduled, hostEmailSent },
      };
    }

    const res = await this.dispatchCustomInvite(dto);
    return { ...res, data: { result: (res as any)?.data, hostEmailSent } };
  }

  /** Human-readable IST time string for the email body. */
  private formatWhen(source?: string): string {
    if (!source) return '';
    const when = new Date(source);
    if (Number.isNaN(when.getTime())) return '';
    return (
      when.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }) + ' (IST)'
    );
  }

  /** Send the organizer their private host link (joins as host). */
  private async dispatchHostEmail(dto: SendCustomInviteDTO) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const hostEmail = (dto.hostEmail ?? '').trim().toLowerCase();
    if (!emailRegex.test(hostEmail) || !dto.hostLink) return null;

    const inviterName = dto.participantName?.trim() || 'Host';
    const title = dto.title?.trim();
    const whenText = this.formatWhen(dto.meetingTime || dto.scheduleAt);

    const subject = title
      ? `You're hosting: ${title}`
      : 'Your meeting host link';

    const titleBlock = title
      ? `<p style="margin:0 0 8px"><strong>Meeting:</strong> ${title}</p>`
      : '';
    const whenBlock = whenText
      ? `<p style="margin:0 0 8px"><strong>When:</strong> ${whenText}</p>`
      : '';

    const template = `
      <div dir="ltr">
        <p>Hi ${inviterName},</p>
        <p>You're the host of this meeting. Use the private link below to start it and admit people from the waiting room.</p>
        ${titleBlock}
        ${whenBlock}
        <p>🎬 Host link (keep this private): <a href="${dto.hostLink}">Start the meeting as host</a></p>
        <p style="color:#64748b;font-size:13px">Anyone who opens this link joins as a host, so don't forward it to guests — send them the regular invite instead.</p>
        <p>
          Regards<br>
          InfyMeet<br>
          Infinity Assurance Solutions Pvt. Ltd.
        </p>
      </div>
    `;

    let icalEvent:
      | { method: string; filename: string; content: string }
      | undefined;
    const whenSource = dto.meetingTime || dto.scheduleAt;
    if (whenSource) {
      const start = new Date(whenSource);
      if (!Number.isNaN(start.getTime())) {
        const durationMinutes =
          Number(dto.durationMinutes) > 0 ? Number(dto.durationMinutes) : 60;
        const ics = this.buildMeetingIcs({
          start,
          durationMinutes,
          summary: title || `${inviterName} – Video meeting (host)`,
          description: `Host link: ${dto.hostLink}`,
          location: dto.hostLink,
          organizerName: inviterName,
          organizerEmail: 'no-reply@infinityassurance.com',
          attendees: [hostEmail],
        });
        icalEvent = { method: 'REQUEST', filename: 'invite.ics', content: ics };
      }
    }

    return this.helperService.sendEmail(
      template,
      { name: 'Host' },
      hostEmail,
      subject,
      undefined,
      icalEvent,
    );
  }

  private async dispatchCustomInvite(
    dto: SendCustomInviteDTO,
  ) {
    const { meetingLink, participantName, subject, message, title } = dto;

    // Normalise + validate emails (drop blanks / non-emails / duplicates).
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const clean = (list?: string[]) =>
      Array.from(
        new Set(
          (list ?? [])
            .map((e) => (e ?? '').trim().toLowerCase())
            .filter((e) => emailRegex.test(e)),
        ),
      );

    const emails = clean(dto.emails);
    // CC recipients (exclude any that are already in the To list).
    const cc = clean(dto.cc).filter((e) => !emails.includes(e));

    if (!meetingLink) {
      return {
        statusCode: 400,
        isSuccess: false,
        message: 'meetingLink is required',
        data: null,
      };
    }

    if (emails.length === 0) {
      return {
        statusCode: 400,
        isSuccess: false,
        message: 'At least one valid email is required',
        data: null,
      };
    }

    const inviterName = participantName?.trim() || 'InfyMeet';
    const mailSubject =
      subject?.trim() ||
      (title?.trim()
        ? `Invitation: ${title.trim()}`
        : `${inviterName} has invited you to a video meeting`);

    const titleBlock = title?.trim()
      ? `<p style="margin:0 0 8px"><strong>Meeting:</strong> ${title.trim()}</p>`
      : '';

    // Always show the scheduled meeting time when available (independent of
    // when the email itself is sent). Format in IST for consistency.
    const whenSource = dto.meetingTime || dto.scheduleAt;
    let whenBlock = '';
    if (whenSource) {
      const when = new Date(whenSource);
      if (!Number.isNaN(when.getTime())) {
        const whenText = when.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });
        whenBlock = `<p style="margin:0 0 8px"><strong>When:</strong> ${whenText} (IST)</p>`;
      }
    }

    // Only render the inviter's custom message; the standard invite line below
    // is the single source of the "you're invited" sentence (no duplication).
    const messageBlock = message?.trim()
      ? `<p style="margin:0 0 12px">${message.trim().replace(/\n/g, '<br>')}</p>`
      : '';

    const template = `
      <div dir="ltr">
        <p>Hello,</p>
        <p><strong>${inviterName}</strong> has invited you to a video meeting on InfyMeet.</p>
        ${titleBlock}
        ${whenBlock}
        ${messageBlock}
        <p>📍 Meeting Link: <a href="${meetingLink}">Click here to join</a></p>
        <p>
          Regards<br>
          ${inviterName}<br>
          Infinity Assurance Solutions Pvt. Ltd.
        </p>
      </div>
    `;

    // Build a calendar event (.ics) so Google / Apple / Outlook auto-add it.
    let icalEvent:
      | { method: string; filename: string; content: string }
      | undefined;
    if (whenSource) {
      const start = new Date(whenSource);
      if (!Number.isNaN(start.getTime())) {
        const durationMinutes =
          Number(dto.durationMinutes) > 0 ? Number(dto.durationMinutes) : 60;
        const ics = this.buildMeetingIcs({
          start,
          durationMinutes,
          summary: title?.trim() || `${inviterName} – Video meeting`,
          description: `${message?.trim() ? message.trim() + '\\n\\n' : ''}Join: ${meetingLink}`,
          location: meetingLink,
          organizerName: inviterName,
          organizerEmail: 'no-reply@infinityassurance.com',
          attendees: [...emails, ...cc],
        });
        icalEvent = { method: 'REQUEST', filename: 'invite.ics', content: ics };
      }
    }

    // Single email: all invitees in To, optional CC list (Google-Meet style).
    const emailRes = await this.helperService.sendEmail(
      template,
      { name: 'Guest' },
      emails.join(', '),
      mailSubject,
      cc.length > 0 ? cc.join(', ') : undefined,
      icalEvent,
    );

    return {
      statusCode: 200,
      isSuccess: true,
      message: dto.scheduleAt
        ? 'Meeting scheduled & invite email sent successfully'
        : 'Invite email sent successfully',
      data: [
        { type: 'to', recipients: emails, isSuccess: emailRes },
        ...(cc.length ? [{ type: 'cc', recipients: cc, isSuccess: emailRes }] : []),
      ],
    };
  }

  /**
   * Build a minimal but valid iCalendar (RFC 5545) event string.
   * Used as a text/calendar (METHOD:REQUEST) part so Gmail, Apple Calendar
   * and Outlook detect the invite and add it to the recipient's calendar.
   */
  private buildMeetingIcs(opts: {
    start: Date;
    durationMinutes: number;
    summary: string;
    description: string;
    location: string;
    organizerName: string;
    organizerEmail: string;
    attendees: string[];
  }): string {
    const toUtc = (d: Date) =>
      d
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');

    // Escape per RFC 5545 (commas, semicolons, backslashes, newlines).
    const esc = (s: string) =>
      (s ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');

    const end = new Date(opts.start.getTime() + opts.durationMinutes * 60 * 1000);
    const uid = `${randomUUID()}@infymeet`;

    const attendeeLines = opts.attendees.map(
      (email) =>
        `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${email}:mailto:${email}`,
    );

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//InfyMeet//Meeting Invite//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${toUtc(new Date())}`,
      `DTSTART:${toUtc(opts.start)}`,
      `DTEND:${toUtc(end)}`,
      `SUMMARY:${esc(opts.summary)}`,
      `DESCRIPTION:${esc(opts.description)}`,
      `LOCATION:${esc(opts.location)}`,
      `URL:${opts.location}`,
      `ORGANIZER;CN=${esc(opts.organizerName)}:mailto:${opts.organizerEmail}`,
      ...attendeeLines,
      'STATUS:CONFIRMED',
      'SEQUENCE:0',
      'TRANSP:OPAQUE',
      'BEGIN:VALARM',
      'TRIGGER:-PT10M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Reminder',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ];

    // RFC 5545 requires CRLF line endings.
    return lines.join('\r\n');
  }

  @Post('/test-whatsapp')
  async testWhatsapp(
    @Body() body: TestWhatsappDto,
  ) {
    if (!body?.mobile) {
      return {
        success: false,
        error: 'mobile is required',
      };
    }
    try {
      const meetingLink =
        `https://meetings.infyshield.com/test/${Date.now()}`;


      const response = await this.whatsappService.sendMeetingLink(
        body.mobile as string,
        meetingLink,
      );

      return {
        success: true,
        mobile: body.mobile,
        meetingLink,
        response,
      };


    } catch (error) {
      return {
        success: false,
        error: (error as any)?.response?.data || (error as Error)?.message,
      };
    }
  }

  @Get('customer-info')
  async getCustomerInfoByTicketNo(

    @Query('ticketNo')
    ticketNo: string,

  ) {

    return await this.personInfoService
      .getCustomerInfoByTicketNo(
        ticketNo,
      );
  }

  @Get('assigned-technicians')
  async getAssignedTechniciansByTicketNo(
    @Query('ticketNo')
    ticketNo: string,
  ) {
    return this.personInfoService.getAssignedTechniciansByTicketNo(
      ticketNo,
    );
  }
  @Post('video-call-request')
  async createVideoCall(
    @Body() payload: {
      ticketNo: string;
      roomId: string;
      callerId: string;
      callerName: string;
      receiverId: string;
      receiverName: string;
      videoCallType: string;
    },
  ) {
    return this.personInfoService.createVideoCall(
      payload,
    );
  }
  @Get('user')
  async getUserByEmailOrMobile(
    @Query('email') email?: string,
    @Query('mobile') mobile?: string,
    @Headers('authorization') authorization?: string,
  ) {
    let resolvedEmail = email?.trim() || undefined
    let resolvedMobile = mobile?.trim() || undefined

    if (!resolvedEmail && !resolvedMobile && authorization?.startsWith('Bearer ')) {
      try {
        const payload = await this.authService.verifyToken(authorization.slice(7).trim())
        const p = payload as Record<string, unknown>
        resolvedEmail =
          (typeof p.email === 'string' && p.email) ||
          (typeof p.Email === 'string' && p.Email) ||
          undefined
        resolvedMobile =
          (typeof p.mobile === 'string' && p.mobile) ||
          (typeof p.Mobile === 'string' && p.Mobile) ||
          undefined
      } catch {
        return {
          status: false,
          data: [],
          message: 'Invalid or expired token.',
        }
      }
    }

    return this.personInfoService.getUserByEmailOrMobile(resolvedEmail, resolvedMobile);
  }
}
