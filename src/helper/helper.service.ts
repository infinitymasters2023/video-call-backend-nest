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
    async sendEmail(
        template: string,
        data: any,
        to: string,
        subject: string,
        cc?: string | string[],
        icalEvent?: { method?: string; filename?: string; content: string },
    ) {
        const compiledTemplate = handlebars.compile(template)(data);
        const mailOptions: {
            from: string;
            to: string;
            subject: string;
            html: string;
            cc?: string | string[];
            icalEvent?: { method?: string; filename?: string; content: string };
        } = {
            from: 'no-reply@infinityassurance.com',
            to,
            subject,
            html: compiledTemplate,
        };
        if (cc && (Array.isArray(cc) ? cc.length > 0 : cc.trim() !== '')) {
            mailOptions.cc = cc;
        }
        if (icalEvent && icalEvent.content) {
            // nodemailer adds this as a text/calendar part so Gmail / Apple Mail
            // / Outlook detect it as a calendar invite and auto-add the event.
            mailOptions.icalEvent = {
                method: icalEvent.method || 'REQUEST',
                filename: icalEvent.filename || 'invite.ics',
                content: icalEvent.content,
            };
        }
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

    /**
     * Send an SMS and report what the gateway actually said.
     *
     * A 200 from the push endpoint only means the request was accepted — the
     * body still carries the verdict, and a DLT template mismatch shows up
     * there rather than as an HTTP error. Callers that need to know whether the
     * message really went out should use this instead of `sendSms`.
     */
    async sendSmsChecked(
        number: string,
        message: string,
        contentTemplateId: string,
    ): Promise<{ ok: boolean; detail: string }> {
        const response = await axios.get('https://api.mobilnxt.in/api/push', {
            params: {
                accesskey: 'uW9h2HHRlctDRlGwOQKEicLgsgBi2V',
                to: number,
                text: message,
                from: 'ISHILD',
                tid: contentTemplateId,
            },
            timeout: 15000,
        });

        const detail =
            typeof response.data === 'string'
                ? response.data
                : JSON.stringify(response.data ?? '');

        console.log('SMS API response:', detail);

        if (response.status !== 200) {
            return { ok: false, detail: `HTTP ${response.status}: ${detail}` };
        }

        // Heuristic only — the exact success payload this gateway returns is not
        // documented here, so a suspected rejection is surfaced for the caller
        // to log rather than treated as authoritative. Never widen this into a
        // hard failure without confirming the real response format first.
        const suspected =
            /(error|invalid|failed|failure|reject(ed)?|insufficient|blocked)/i.test(
                detail,
            ) && !/(error|failure)\s*[:=]\s*(null|none|0|false)/i.test(detail);

        if (suspected) {
            console.error(
                'SMS accepted by HTTP but the gateway response looks like a rejection:',
                detail,
            );
        }

        return { ok: !suspected, detail };
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


    async getLastSixDigits(inputString: string): Promise<string> {
        if (inputString.length <= 6) {
            return inputString; // Return the entire input if it has 6 or fewer characters
        } else {
            return inputString.substring(inputString.length - 6); // Return the last six characters
        }
    }

}
