import { Body, Controller, HttpStatus, Post, HttpCode, UsePipes, ValidationPipe, Get, Param, Query, Headers , OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';

import {
  ApiTags,
} from '@nestjs/swagger';
import { PersonInfoService } from './personinfo.service';
import { GetServiceCallDTO, SendCustomInviteDTO, SendMeetingDTO, TestWhatsappDto } from './personinfo.dtos';
import { HelperService } from 'src/helper/helper.service';
import { WhatsappService } from 'src/helper/whatsapp.service';
import { MeetingSchedulerService } from './meeting-scheduler.service';
import { MeetingsRepository } from 'src/meeting/meetings.repository';
import { ScheduledJobsRepository } from 'src/meeting/scheduled-jobs.repository';
import { AuthService } from 'src/auth/auth.service';



@ApiTags('person-info')
@Controller('person-info')
export class PersonInfoController implements OnModuleInit {
  constructor(
    private readonly personInfoService: PersonInfoService,
    private readonly helperService: HelperService,
    private readonly whatsappService: WhatsappService,
    private readonly meetingSchedulerService: MeetingSchedulerService,
    private readonly authService: AuthService,
    private readonly meetingsRepo: MeetingsRepository,
    private readonly jobsRepo: ScheduledJobsRepository,
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
    // Log the meeting and who it went to before anything is sent, so the
    // dashboard and the free-meeting count reflect it even if delivery later
    // fails. Keyed on room id, so re-inviting does not create a second row.
    const meetingId = await this.recordInvitedMeeting(dto);

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
      const meetingAt = new Date(dto.scheduleAt);

      if (Number.isNaN(meetingAt.getTime())) {
        return {
          statusCode: 400,
          isSuccess: false,
          message: 'Invalid scheduleAt datetime',
          data: null,
        };
      }

      if (meetingAt.getTime() <= Date.now()) {
        return {
          statusCode: 400,
          isSuccess: false,
          message: 'scheduleAt must be a future datetime',
          data: null,
        };
      }

      // Send the invite NOW, carrying a calendar event for the future time.
      //
      // This used to queue the invite to go out AT the meeting's start, which
      // meant nobody was told about the meeting until it was already beginning
      // and the calendar entry only appeared at that moment. Scheduling a
      // meeting has to put it in people's calendars straight away — that is the
      // whole point of scheduling it.
      const invite = await this.dispatchCustomInvite(dto);

      // A short nudge before it starts. The calendar entry carries its own
      // 10-minute alarm, so this is a belt-and-braces email for anyone who
      // never added it.
      const REMINDER_LEAD_MS = 10 * 60 * 1000;
      const remindAt = new Date(
        Math.max(meetingAt.getTime() - REMINDER_LEAD_MS, Date.now() + 60 * 1000),
      );

      const scheduled = this.meetingSchedulerService.scheduleMeeting(
        remindAt,
        async () => this.dispatchReminder(dto),
        {
          meetingId: meetingId ?? undefined,
          uid: this.meetingUid(dto.meetingLink),
          meetingLink: dto.meetingLink,
          title: dto.title?.trim() || undefined,
          hostName: dto.participantName?.trim() || undefined,
          hostEmail: dto.hostEmail?.trim().toLowerCase() || undefined,
          emails: dto.emails ?? [],
          durationMinutes:
            Number(dto.durationMinutes) > 0 ? Number(dto.durationMinutes) : 60,
          meetingAt: meetingAt.toISOString(),
        },
      );

      return {
        statusCode: 200,
        isSuccess: true,
        message: hostEmailSent
          ? 'Meeting scheduled — invites sent and your host link emailed to you'
          : 'Meeting scheduled and invites sent',
        data: {
          ...scheduled,
          meetingAt: meetingAt.toISOString(),
          hostEmailSent,
          invite: (invite as any)?.data ?? null,
        },
      };
    }

    const res = await this.dispatchCustomInvite(dto);
    return { ...res, data: { result: (res as any)?.data, hostEmailSent } };
  }

  /**
   * Write the meeting row plus its invitee rows for an invite request.
   *
   * Returns the meeting id, or null when the write failed — sending must never
   * be blocked by a logging problem, so callers treat null as "carry on".
   */
  private async recordInvitedMeeting(dto: SendCustomInviteDTO): Promise<number | null> {
    try {
      let roomId = '';
      try {
        roomId = new URL(dto.meetingLink).searchParams.get('roomId') ?? '';
      } catch {
        /* unparseable link — nothing to key on */
      }
      if (!roomId) return null;

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const clean = (list?: string[]) =>
        Array.from(
          new Set(
            (list ?? [])
              .map((e) => (e ?? '').trim().toLowerCase())
              .filter((e) => emailRegex.test(e)),
          ),
        );

      const to = clean(dto.emails);
      const cc = clean(dto.cc);
      const whenSource = dto.scheduleAt || dto.meetingTime;
      const start = whenSource ? new Date(whenSource) : null;

      const meetingId = await this.meetingsRepo.recordMeeting({
        roomId,
        hostName: dto.participantName?.trim() || null,
        hostEmail: dto.hostEmail?.trim().toLowerCase() || null,
        title: dto.title?.trim() || null,
        meetingLink: dto.meetingLink,
        hostLink: dto.hostLink ?? null,
        calendarUid: this.meetingUid(dto.meetingLink),
        scheduledStart: start && !Number.isNaN(start.getTime()) ? start : null,
        durationMinutes:
          Number(dto.durationMinutes) > 0 ? Number(dto.durationMinutes) : null,
        meetingType: dto.scheduleAt ? 'scheduled' : 'instant',
      });

      if (meetingId) {
        await this.meetingsRepo.recordParticipants(meetingId, [
          ...(dto.hostEmail
            ? [{
                email: dto.hostEmail.trim().toLowerCase(),
                name: dto.participantName ?? null,
                role: 'host',
                channel: 'to',
              }]
            : []),
          ...to.map((email) => ({ email, role: 'guest', channel: 'to' })),
          ...cc.map((email) => ({ email, role: 'guest', channel: 'cc' })),
        ]);
      }

      return meetingId;
    } catch (err) {
      console.error('Could not log the invited meeting', err);
      return null;
    }
  }

  /**
   * Re-arm invite timers that were pending when the process last stopped.
   *
   * The stored payload is the original invite request, so feeding it back
   * through dispatchCustomInvite reconstructs exactly the work that was queued.
   */
  async onModuleInit(): Promise<void> {
    await this.meetingSchedulerService.restorePending(
      (payload) => async () => this.dispatchCustomInvite(payload as SendCustomInviteDTO),
    );
  }

  /**
   * Every scheduled meeting, soonest first.
   *
   * Read from the database rather than the in-process timer map, so the list
   * still shows everything after a restart. Live status changes are mirrored
   * into the table as they happen, so the two agree.
   */
  @Get('/scheduled_meetings')
  async listScheduledMeetings(@Query('hostEmail') hostEmail?: string) {
    const rows = await this.jobsRepo.listForHost(hostEmail);

    const data = rows.map((r: any) => {
      let payload: any = {};
      try {
        payload = r.Payload ? JSON.parse(r.Payload) : {};
      } catch {
        /* a malformed payload should not hide the row */
      }

      return {
        scheduleId: r.ScheduleGuid,
        // The stored RunAt is the reminder; people care about the meeting.
        runAt: payload.meetingAt ?? r.RunAt,
        reminderAt: r.RunAt,
        createdAt: r.CreatedDate,
        status: r.Status,
        completedAt: r.CompletedAt,
        error: r.LastError,
        meta: {
          uid: r.CalendarUID,
          meetingLink: r.MeetingLink,
          title: r.Title,
          hostName: r.HostName,
          hostEmail: r.HostEmail,
          emails: payload.emails ?? [],
          durationMinutes: r.DurationMinutes,
        },
      };
    });

    // Anything this process queued but could not persist (no room id on the
    // link) would otherwise be invisible, so fold it in.
    const known = new Set(data.map((d) => String(d.scheduleId).toLowerCase()));
    const inMemory = this.meetingSchedulerService
      .listJobs(hostEmail ? { hostEmail } : undefined)
      .filter((j) => !known.has(String(j.scheduleId).toLowerCase()));

    return {
      statusCode: 200,
      isSuccess: true,
      message: 'OK',
      data: [...data, ...inMemory].sort((a, b) =>
        String(a.runAt).localeCompare(String(b.runAt)),
      ),
    };
  }

  /**
   * Move a scheduled meeting to a new time.
   *
   * Anyone already holding the calendar invite gets an update carrying the same
   * UID and a higher SEQUENCE, so their existing event moves instead of a
   * second one appearing beside it.
   */
  @Post('/reschedule_meeting')
  async rescheduleMeeting(
    @Body() body: { scheduleId?: string; newTime?: string; notify?: boolean },
  ) {
    const scheduleId = (body?.scheduleId ?? '').trim();
    const runAt = new Date(body?.newTime ?? '');

    if (!scheduleId) {
      return { statusCode: 400, isSuccess: false, message: 'scheduleId is required', data: null };
    }
    if (Number.isNaN(runAt.getTime())) {
      return { statusCode: 400, isSuccess: false, message: 'Invalid newTime', data: null };
    }
    if (runAt.getTime() <= Date.now()) {
      return { statusCode: 400, isSuccess: false, message: 'Pick a future date and time.', data: null };
    }

    const job = this.meetingSchedulerService.getJobStatus(scheduleId);
    if (!job) {
      return { statusCode: 404, isSuccess: false, message: 'That scheduled meeting no longer exists.', data: null };
    }

    // The user picks the meeting's new time; the job itself is a reminder, so
    // it is re-armed shortly before that rather than exactly on it.
    const REMINDER_LEAD_MS = 10 * 60 * 1000;
    const remindAt = new Date(
      Math.max(runAt.getTime() - REMINDER_LEAD_MS, Date.now() + 60 * 1000),
    );

    const moved = this.meetingSchedulerService.reschedule(scheduleId, remindAt);
    if (!moved.ok) {
      return {
        statusCode: 409,
        isSuccess: false,
        message:
          moved.reason === 'completed'
            ? 'Those invites have already gone out, so the time cannot be changed here.'
            : `This meeting cannot be rescheduled (${moved.reason}).`,
        data: null,
      };
    }

    this.meetingSchedulerService.updateMeta(scheduleId, {
      meetingAt: runAt.toISOString(),
    });

    let notified = false;
    if (body?.notify !== false) {
      notified = await this.sendCalendarUpdate(job.meta, runAt, 'REQUEST');
    }

    return {
      statusCode: 200,
      isSuccess: true,
      message: notified ? 'Meeting moved and everyone notified.' : 'Meeting moved.',
      data: { scheduleId, runAt: runAt.toISOString(), notified },
    };
  }

  /** Cancel a scheduled meeting and withdraw the calendar event. */
  @Post('/cancel_meeting')
  async cancelMeeting(@Body() body: { scheduleId?: string; notify?: boolean }) {
    const scheduleId = (body?.scheduleId ?? '').trim();
    if (!scheduleId) {
      return { statusCode: 400, isSuccess: false, message: 'scheduleId is required', data: null };
    }

    const job = this.meetingSchedulerService.getJobStatus(scheduleId);
    if (!job) {
      return { statusCode: 404, isSuccess: false, message: 'That scheduled meeting no longer exists.', data: null };
    }

    const stopped = this.meetingSchedulerService.cancel(scheduleId);
    if (!stopped.ok) {
      return {
        statusCode: 409,
        isSuccess: false,
        message:
          stopped.reason === 'completed'
            ? 'Those invites have already been sent.'
            : `This meeting cannot be cancelled (${stopped.reason}).`,
        data: null,
      };
    }

    let notified = false;
    if (body?.notify !== false) {
      notified = await this.sendCalendarUpdate(
        job.meta,
        new Date((job.meta as any)?.meetingAt || job.runAt),
        'CANCEL',
      );
    }

    return {
      statusCode: 200,
      isSuccess: true,
      message: notified ? 'Meeting cancelled and everyone notified.' : 'Meeting cancelled.',
      data: { scheduleId, notified },
    };
  }

  /**
   * Short "starting soon" nudge for a meeting whose invite already went out.
   *
   * Deliberately carries no calendar attachment: the event is already in
   * everyone's calendar from the original invite, and sending another REQUEST
   * here would just be a second copy of the same thing.
   */
  private async dispatchReminder(dto: SendCustomInviteDTO) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const recipients = Array.from(
      new Set(
        [...(dto.emails ?? []), ...(dto.cc ?? []), dto.hostEmail ?? '']
          .map((e) => (e ?? '').trim())
          .filter((e) => emailRegex.test(e)),
      ),
    );
    if (recipients.length === 0) {
      return { statusCode: 200, isSuccess: false, message: 'No recipients', data: null };
    }

    const hostName = dto.participantName?.trim() || 'Host';
    const title = dto.title?.trim() || `${hostName} - Video meeting`;
    const whenText = this.formatWhen(dto.scheduleAt || dto.meetingTime);

    const template = `
      <div dir="ltr">
        <p>Hello,</p>
        <p>A quick reminder: <strong>${title}</strong> starts shortly.</p>
        <p style="margin:0 0 8px"><strong>When:</strong> ${whenText}</p>
        <p>Meeting Link: <a href="${dto.meetingLink}">Click here to join</a></p>
        <p>
          Regards<br>
          ${hostName}<br>
          Infinity Assurance Solutions Pvt. Ltd.
        </p>
      </div>
    `;

    const res = await this.helperService.sendEmail(
      template,
      { name: 'Guest' },
      recipients.join(', '),
      `Starting soon: ${title}`,
      undefined,
      undefined,
    );

    return {
      statusCode: 200,
      isSuccess: res === 'Email sent successfully',
      message: 'Reminder sent',
      data: { recipients },
    };
  }

  /**
   * Email a calendar update (a move or a withdrawal) for an existing meeting.
   *
   * Reuses the meeting's UID with a bumped SEQUENCE, which is what makes a
   * calendar treat this as the same event rather than a new one.
   */
  private async sendCalendarUpdate(
    meta: {
      uid?: string;
      meetingLink?: string;
      title?: string;
      hostName?: string;
      hostEmail?: string;
      emails?: string[];
      durationMinutes?: number;
    },
    start: Date,
    method: 'REQUEST' | 'CANCEL',
  ): Promise<boolean> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const recipients = Array.from(
      new Set(
        [...(meta.emails ?? []), meta.hostEmail ?? '']
          .map((e) => (e ?? '').trim())
          .filter((e) => emailRegex.test(e)),
      ),
    );
    if (recipients.length === 0) return false;

    const uid = meta.uid || this.meetingUid(meta.meetingLink ?? '');
    const sequence = await this.bumpCalendarSequence(meta.meetingLink, uid);
    const hostName = meta.hostName || 'Host';
    const title = meta.title || `${hostName} - Video meeting`;
    const whenText = this.formatWhen(start.toISOString());
    const cancelled = method === 'CANCEL';

    const template = cancelled
      ? `
      <div dir="ltr">
        <p>Hello,</p>
        <p><strong>${hostName}</strong> has cancelled this meeting.</p>
        <p style="margin:0 0 8px"><strong>Meeting:</strong> ${title}</p>
        <p style="margin:0 0 8px"><strong>Was scheduled for:</strong> ${whenText}</p>
        <p>It has been removed from your calendar. No action is needed.</p>
        <p>Regards<br>${hostName}<br>Infinity Assurance Solutions Pvt. Ltd.</p>
      </div>`
      : `
      <div dir="ltr">
        <p>Hello,</p>
        <p><strong>${hostName}</strong> has moved this meeting to a new time.</p>
        <p style="margin:0 0 8px"><strong>Meeting:</strong> ${title}</p>
        <p style="margin:0 0 8px"><strong>New time:</strong> ${whenText}</p>
        <p>Meeting Link: <a href="${meta.meetingLink}">Click here to join</a></p>
        <p>Your calendar entry has been updated automatically.</p>
        <p>Regards<br>${hostName}<br>Infinity Assurance Solutions Pvt. Ltd.</p>
      </div>`;

    const ics = this.buildMeetingIcs({
      start,
      durationMinutes:
        meta.durationMinutes && meta.durationMinutes > 0 ? meta.durationMinutes : 60,
      summary: title,
      description: cancelled
        ? 'This meeting has been cancelled.'
        : `Join: ${meta.meetingLink ?? ''}`,
      location: meta.meetingLink ?? '',
      organizerName: hostName,
      organizerEmail: 'no-reply@infinityassurance.com',
      attendees: recipients,
      uid,
      sequence,
      method,
    });

    try {
      const res = await this.helperService.sendEmail(
        template,
        { name: 'Guest' },
        recipients.join(', '),
        cancelled ? `Cancelled: ${title}` : `Updated: ${title}`,
        undefined,
        { method, filename: cancelled ? 'cancel.ics' : 'invite.ics', content: ics },
      );
      return res === 'Email sent successfully';
    } catch {
      return false;
    }
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
          // Same UID as the invitee copy, so a host who is also on the invite
          // list ends up with one calendar event instead of two.
          uid: this.meetingUid(dto.meetingLink),
          sequence: await this.calendarSequence(dto.meetingLink),
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
          uid: this.meetingUid(meetingLink),
          sequence: await this.calendarSequence(meetingLink),
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
  /** The room id inside a meeting link, or '' when there isn't one. */
  private roomIdOf(meetingLink?: string): string {
    try {
      return new URL(meetingLink ?? '').searchParams.get('roomId') ?? '';
    } catch {
      return '';
    }
  }

  /**
   * Current calendar SEQUENCE for a meeting.
   *
   * Prefers the value stored on the meeting row so it survives a restart, and
   * falls back to the in-memory counter when the column is not there yet or the
   * link carries no room id.
   */
  private async calendarSequence(meetingLink?: string, uid?: string): Promise<number> {
    const roomId = this.roomIdOf(meetingLink);
    if (roomId) {
      const stored = await this.meetingsRepo.currentCalendarSequence(roomId);
      if (stored !== null) return stored;
    }
    return this.meetingSchedulerService.currentSequence(
      uid || this.meetingUid(meetingLink ?? ''),
    );
  }

  /** Advance the SEQUENCE for a meeting and return the new value. */
  private async bumpCalendarSequence(meetingLink?: string, uid?: string): Promise<number> {
    const roomId = this.roomIdOf(meetingLink);
    if (roomId) {
      const next = await this.meetingsRepo.nextCalendarSequence(roomId);
      if (next !== null) {
        // Keep the in-memory counter in step so a later fallback cannot hand
        // back a number lower than one already sent.
        this.meetingSchedulerService.setSequence(
          uid || this.meetingUid(meetingLink ?? ''),
          next,
        );
        return next;
      }
    }
    return this.meetingSchedulerService.nextSequence(
      uid || this.meetingUid(meetingLink ?? ''),
    );
  }

  /**
   * A stable calendar UID for a meeting, derived from its room id.
   *
   * Every email about the same meeting must carry the same UID. When the host
   * copy and the invitee copy each generated their own random UID, a host who
   * was also on the invite list received two different events and the calendar
   * showed the meeting twice. Deriving it from the link makes the two copies —
   * and any later reschedule or cancellation — refer to one single event.
   */
  private meetingUid(meetingLink: string): string {
    let roomId = '';
    try {
      roomId = new URL(meetingLink).searchParams.get('roomId') ?? '';
    } catch {
      /* not a parseable URL — fall through to hashing the whole string */
    }
    const key =
      roomId ||
      createHash('sha1').update(meetingLink || 'infymeet').digest('hex').slice(0, 24);
    return `infymeet-${key}@infymeet`;
  }

  private buildMeetingIcs(opts: {
    start: Date;
    durationMinutes: number;
    summary: string;
    description: string;
    location: string;
    organizerName: string;
    organizerEmail: string;
    attendees: string[];
    /** Stable per meeting. Omit only if there is genuinely no meeting to tie to. */
    uid?: string;
    /** Must increase on every update so calendars accept the change. */
    sequence?: number;
    method?: 'REQUEST' | 'CANCEL';
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
    const uid = opts.uid || `${randomUUID()}@infymeet`;
    const method = opts.method ?? 'REQUEST';
    const sequence = Number.isFinite(opts.sequence) ? Number(opts.sequence) : 0;
    const cancelled = method === 'CANCEL';

    const attendeeLines = opts.attendees.map(
      (email) =>
        `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${email}:mailto:${email}`,
    );

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//InfyMeet//Meeting Invite//EN',
      'CALSCALE:GREGORIAN',
      `METHOD:${method}`,
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
      `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
      `SEQUENCE:${sequence}`,
      'TRANSP:OPAQUE',
      // A cancellation carries no alarm — the event is going away.
      ...(cancelled
        ? []
        : [
            'BEGIN:VALARM',
            'TRIGGER:-PT10M',
            'ACTION:DISPLAY',
            'DESCRIPTION:Reminder',
            'END:VALARM',
          ]),
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
