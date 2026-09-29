import { Module } from "@medusajs/framework/utils";
import BroadcastModuleService from "./service";

export const BROADCAST_MODULE = "signalhouse_broadcast";

export default Module(BROADCAST_MODULE, {
	service: BroadcastModuleService,
});
