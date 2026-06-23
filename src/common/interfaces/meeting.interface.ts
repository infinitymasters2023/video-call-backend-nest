export interface IMeetingClaimInfo {

    userid: number;

    emailid: string;

    mobileno: string;

    employeeName: string;

    TicketNO: string;

    customername: string;

    customerMobile: string;

    landlineno: string;

    emailidaddress: string;

    alternateEmailID: string;

    proxyMobile1: string;

    proxyMobile2: string;

    LoanNo: string;

    CertificateNo: string;

    CrnNo: string;

    brand: string;

    productName: string;

    serviceCenterMobile: string;

    serviceCenterEmail: string;

    serviceCenterName: string;

    dealerMobileNo: string;

    dealerMobileNo2: string;

    dealerEmailID: string;

    dealerEmailID2: string;

    dealerName: string;

    clientId: string;
}

export interface IServiceResponse<T = any> {

    status: boolean;

    message: string;

    data: T;
}

export interface IResInputData {

    type: string;

    isSuccess: boolean;
}