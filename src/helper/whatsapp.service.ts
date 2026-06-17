import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class WhatsappService {
    constructor(
        private readonly httpService: HttpService,
    ) { }

    async sendMeetingLink(
        mobile: string,
        meetingLink: string,
    ) {
        const apiKey = '4d953e7d11398d59e7f8d';
        const projectId = '65dc62c305a8e10b9b621174';

        if (mobile.length === 10) {
            mobile = `91${mobile}`;
        }

        const payload = {
            template_params: [meetingLink],
            phone_number: mobile,
            campaign_name: 'InfyMeet Video Call',
            attributes: {
                country: 'India',
            },
            default_country_code: '91',
        };

        const url =
            `https://apis.aisensy.com/project-apis/v1/project/${projectId}/campaign/api/send`;

        const response = await firstValueFrom(
            this.httpService.post(url, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-AiSensy-Project-API-Pwd': apiKey,
                },
            }),
        );

        return response.data;
    }
}