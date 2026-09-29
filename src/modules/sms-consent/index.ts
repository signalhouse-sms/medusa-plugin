import { Module } from "@medusajs/framework/utils";
import SmsConsentModuleService from "./service";

export const SMS_CONSENT_MODULE = "sms_consent";

export default Module(SMS_CONSENT_MODULE, {
	service: SmsConsentModuleService,
});
