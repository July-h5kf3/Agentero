import { useSyncExternalStore } from "react";
import {
	getBackgroundTasksSnapshot,
	subscribeBackgroundTasks,
} from "@/lib/background-tasks";

export function useBackgroundTasks() {
	return useSyncExternalStore(
		subscribeBackgroundTasks,
		getBackgroundTasksSnapshot,
		getBackgroundTasksSnapshot,
	);
}
