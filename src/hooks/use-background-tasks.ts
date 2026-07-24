import { useSyncExternalStore } from "react";
import {
	getBackgroundTasksSnapshot,
	subscribeBackgroundTasks,
} from "@/lib/core/background-tasks";

export function useBackgroundTasks() {
	return useSyncExternalStore(
		subscribeBackgroundTasks,
		getBackgroundTasksSnapshot,
		getBackgroundTasksSnapshot,
	);
}
