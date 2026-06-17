import { Body, Controller, HttpStatus, Post, HttpCode, UsePipes, ValidationPipe, Get, Param, Query } from '@nestjs/common';

import {
  ApiTags,
} from '@nestjs/swagger';
import { PersonInfoService } from './personinfo.service';
import { GetServiceCallDTO, SendMeetingDTO, TestWhatsappDto } from './personinfo.dtos';
import { HelperService } from 'src/helper/helper.service';
import { WhatsappService } from 'src/helper/whatsapp.service';



@ApiTags('person-info')
@Controller('person-info')
export class PersonInfoController {
  constructor(
    private readonly personInfoService: PersonInfoService,
    private readonly helperService: HelperService,
    private readonly whatsappService: WhatsappService,
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
}
