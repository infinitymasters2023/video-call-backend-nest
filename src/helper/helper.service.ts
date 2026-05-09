/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt/dist/jwt.service';
import * as nodemailer from 'nodemailer';
import * as handlebars from 'handlebars';
import axios from 'axios';
import { IMessageSetOptions } from 'node-imap';
@Injectable()
export class HelperService {
    private transporter: nodemailer.Transporter;
    private readonly apiUrl = 'https://api.mobilnxt.in/api/push';
    private readonly apiKey = 'f2fdee93271556e428dd9507b3da7235';
    private readonly senderId = 'InfSLD';
    private readonly route = '12'; // You can adjust the route as needed
    // private readonly jwtService: JwtService;
    constructor() {
        // Create a transporter using SMTP transport
        this.transporter = nodemailer.createTransport({
            service: 'Gmail', // e.g., 'Gmail', 'Outlook'
            auth: {
                user: 'no-reply@infinityassurance.com', // Your email address
                pass: 'mlas jsej cdzd fmdc', // Your email password or app-specific password
            },
        });
    }
    /*======== Message Service ============*/
    getAvailableLanguages(): string[] {
        return ['en'];
    }

    getLanguage(): string {
        return 'en';
    }



    setMessage(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        lang: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        key: string,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        options?: IMessageSetOptions
    ): string {
        return 'en';
    }




    /*============= Date Services =============*/


    /*===== Send Email Service ========*/
    async sendEmail(template: string, data: any, to: string, subject: string) {
        const compiledTemplate = handlebars.compile(template)(data);
        const mailOptions = {
            from: 'no-reply@infinityassurance.com',
            to,
            subject,
            html: compiledTemplate,
        };
        try {
            const response = await this.transporter.sendMail(mailOptions);
            if (response.messageId) {
                return 'Email sent successfully';
            }
        } catch (error) {
            return error
        }
    }

    generateRandomNumber(): number {
        const min = 100000;
        const max = 999999;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    async sendSms(number, message, contentTemplateId) {
        try {
            const response = await axios.get('https://api.mobilnxt.in/api/push', {
                params: {
                    accesskey: 'uW9h2HHRlctDRlGwOQKEicLgsgBi2V',
                    to: number,
                    text: message,
                    from: 'ISHILD',
                    tid: contentTemplateId,
                },
            });
            console.log('SMS API response:', response.data);

            if (response.status === 200) {
                return 'SMS sent successfully';
            } else {
                throw new Error('Failed to send SMS');
            }
        } catch (error) {
            throw error;
        }
    }


    async textEmailOrMobiles(data: string[]) {

        const result: {
            emails: string[];
            mobiles: string[];
        } = {
            emails: [],
            mobiles: [],
        };

        const emailRegex =
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        const mobileRegex =
            /^\d{10}$/;

        data.forEach((item: string) => {

            if (emailRegex.test(item)) {

                result.emails.push(item);

            } else if (mobileRegex.test(item)) {

                result.mobiles.push(item);
            }
        });

        return result;
    }




}
