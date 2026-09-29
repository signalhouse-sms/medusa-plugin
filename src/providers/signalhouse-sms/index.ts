import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import { SignalHouseSmsNotificationService } from "./service";

export default ModuleProvider(Modules.NOTIFICATION, {
	services: [SignalHouseSmsNotificationService],
});
