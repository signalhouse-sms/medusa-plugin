import { Module } from "@medusajs/framework/utils";
import MessageLogModuleService from "./service";

export const MESSAGE_LOG_MODULE = "signalhouse_message_log";

export default Module(MESSAGE_LOG_MODULE, {
	service: MessageLogModuleService,
});
