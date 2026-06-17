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
        try {
            const apiKey = 'e65cec710cb4ae44d27b0';
            const projectId = '671f5ab71e0f320bf9a1aae3';


            // Remove spaces, +, -, etc.
            mobile = mobile.replace(/\D/g, '');

            // Convert 10 digit mobile to 91XXXXXXXXXX
            if (mobile.length === 10) {
                mobile = `91${mobile}`;
            }

            const payload = {
                name: 'Infinity Customer Care',

                phone_number: mobile,

                campaign_name: 'video_call_invitation',

                template_params: [
                    meetingLink,
                ],

                attributes: {
                    country: 'India',
                },

                default_country_code: '91',
            };

            const url =
                `https://apis.aisensy.com/project-apis/v1/project/${projectId}/campaign/api/send`;

            console.log('==============================');
            console.log('WhatsApp URL =>', url);
            console.log(
                'WhatsApp Payload =>',
                JSON.stringify(payload, null, 2),
            );
            console.log('==============================');

            const response = await firstValueFrom(
                this.httpService.post(
                    url,
                    payload,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'application/json',
                            'X-AiSensy-Project-API-Pwd': apiKey,
                        },
                    },
                ),
            );

            console.log(
                'WhatsApp Success =>',
                JSON.stringify(response.data, null, 2),
            );

            return response.data;


        } catch (error: any) {
            console.error(
                'WhatsApp Error =>',
                JSON.stringify(
                    error?.response?.data ||
                    error?.message ||
                    error,
                    null,
                    2,
                ),
            );


            throw error;


        }
    }


}
