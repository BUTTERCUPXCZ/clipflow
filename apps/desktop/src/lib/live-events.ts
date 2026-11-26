import { api } from "./api";
import { EventsClient, eventsUrl } from "./events";

/** The app's single live-update connection (ws://localhost:3000/ws next to the REST API). */
export const liveEvents = new EventsClient(eventsUrl(api.baseUrl));
