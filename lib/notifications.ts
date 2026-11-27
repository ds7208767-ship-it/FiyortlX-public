import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export type NativeReminder = {
  key: string;
  title: string;
  body: string;
  at: Date;
  kind: "fixed" | "card" | "limit" | "balance";
};

export type NotificationSyncResult =
  | { status: "skipped" }
  | { status: "permission-denied" }
  | { status: "scheduled"; count: number };

const STORAGE_PREFIX = "fiyortx-native-notifications:";
const CHANNEL_ID = "fiyortx_reminders";
const APP_ID = "fiyortx";
const syncQueues = new Map<string, Promise<unknown>>();

function getStorageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

function readScheduledIds(userId: string): number[] {
  const raw = localStorage.getItem(getStorageKey(userId));
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (id): id is number =>
        Number.isInteger(id) && id > 0 && id <= 2_147_483_647,
    );
  } catch (error) {
    console.warn("Yerel bildirim kayıtları okunamadı:", error);
    localStorage.removeItem(getStorageKey(userId));
    return [];
  }
}

function notificationId(key: string, usedIds: Set<number>) {
  let hash = 2_166_136_261;
  for (const character of key) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  }

  let id = 1_500_000_000 + ((hash >>> 0) % 600_000_000);
  while (usedIds.has(id)) {
    id = id >= 2_099_999_999 ? 1_500_000_000 : id + 1;
  }
  usedIds.add(id);
  return id;
}

function getRandomAllowedSlot(reminder: NativeReminder, now = new Date()) {
  let targetDate = new Date(
    reminder.at.getFullYear(),
    reminder.at.getMonth(),
    reminder.at.getDate(),
  );
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (reminder.kind === "limit" || reminder.kind === "balance") {
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    targetDate = today;
    if (minutesNow >= 8 * 60 + 30) targetDate.setDate(targetDate.getDate() + 1);
  } else {
    if (targetDate < today) return null;
    if (targetDate.getTime() === today.getTime() && now.getHours() >= 9) return null;
  }

  const allowedStartMinute = 9 * 60;
  const allowedEndMinute = 14 * 60 + 59;
  const targetIsToday = targetDate.getTime() === today.getTime();
  const earliestMinute = targetIsToday
    ? Math.floor((now.getTime() + 5 * 60_000 - targetDate.getTime()) / 60_000) + 1
    : allowedStartMinute;
  const firstAllowedMinute = Math.max(allowedStartMinute, earliestMinute);
  if (firstAllowedMinute > allowedEndMinute) return null;

  const minuteOfDay =
    firstAllowedMinute +
    Math.floor(Math.random() * (allowedEndMinute - firstAllowedMinute + 1));
  const at = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  );
  if (at.getHours() < 9 || at.getHours() >= 15) return null;
  return at;
}

async function cancelUserPendingNotifications(userId: string) {
  const trackedIds = new Set(readScheduledIds(userId));
  const { notifications: pending } = await LocalNotifications.getPending();
  const owned = pending.filter(
    (notification) =>
      trackedIds.has(notification.id) ||
      (notification.extra?.app === APP_ID && notification.extra?.userId === userId),
  );

  if (owned.length > 0) {
    await LocalNotifications.cancel({
      notifications: owned.map(({ id }) => ({ id })),
    });
  }
  localStorage.setItem(getStorageKey(userId), "[]");
}

async function syncLocalNotifications(
  userId: string,
  reminders: NativeReminder[],
  notificationsEnabled: boolean,
): Promise<NotificationSyncResult> {
  if (!Capacitor.isNativePlatform()) return { status: "skipped" };

  await cancelUserPendingNotifications(userId);

  if (!notificationsEnabled) {
    return { status: "scheduled", count: 0 };
  }
  if (reminders.length === 0) {
    return { status: "scheduled", count: 0 };
  }

  const { display } = await LocalNotifications.checkPermissions();
  if (display !== "granted") {
    localStorage.setItem(getStorageKey(userId), "[]");
    return { status: "permission-denied" };
  }

  if (Capacitor.getPlatform() === "android") {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: "Fiyor₺X Hatırlatmaları",
      description: "Sabit kayıt ve kredi kartı günü hatırlatmaları",
      importance: 3,
      visibility: 0,
    });
  }

  const usedIds = new Set<number>();
  const notifications = reminders.flatMap((reminder) => {
    const at = getRandomAllowedSlot(reminder);
    if (!at) return [];
    return [{
      id: notificationId(`${userId}:${reminder.key}`, usedIds),
      title: reminder.title,
      body: reminder.body,
      schedule: { at },
      channelId: CHANNEL_ID,
      extra: { app: APP_ID, userId },
    }];
  });

  const safeNotifications = notifications.filter(({ schedule }) => {
    const hour = schedule.at.getHours();
    return hour >= 9 && hour < 15;
  });

  if (safeNotifications.length === 0) {
    return { status: "scheduled", count: 0 };
  }

  const result = await LocalNotifications.schedule({ notifications: safeNotifications });
  try {
    localStorage.setItem(
      getStorageKey(userId),
      JSON.stringify(result.notifications.map((notification) => notification.id)),
    );
  } catch (error) {
    await LocalNotifications.cancel({
      notifications: result.notifications.map(({ id }) => ({ id })),
    });
    throw error;
  }

  return { status: "scheduled", count: result.notifications.length };
}

export async function requestLocalNotificationPermission(): Promise<boolean | null> {
  if (!Capacitor.isNativePlatform()) return null;

  const current = await LocalNotifications.checkPermissions();
  if (current.display === "granted") return true;

  const requested = await LocalNotifications.requestPermissions();
  return requested.display === "granted";
}

async function cleanNearOrExpiredNotifications(userId: string) {
  if (!Capacitor.isNativePlatform()) return;
  const { notifications: pending } = await LocalNotifications.getPending();
  const cutoff = Date.now() + 5 * 60_000;
  const trackedIds = new Set(readScheduledIds(userId));
  const nearOrExpired = pending.filter((notification) => {
    const isOwned =
      trackedIds.has(notification.id) ||
      (notification.extra?.app === APP_ID && notification.extra?.userId === userId);
    const scheduledAt = notification.schedule?.at;
    if (!isOwned || !scheduledAt) return false;
    const at = scheduledAt instanceof Date ? scheduledAt : new Date(String(scheduledAt));
    return Number.isFinite(at.getTime()) && at.getTime() <= cutoff;
  });

  if (nearOrExpired.length === 0) return;
  await LocalNotifications.cancel({
    notifications: nearOrExpired.map(({ id }) => ({ id })),
  });
  const canceledIds = new Set(nearOrExpired.map(({ id }) => id));
  localStorage.setItem(
    getStorageKey(userId),
    JSON.stringify([...trackedIds].filter((id) => !canceledIds.has(id))),
  );
}

function enqueueForUser<T extends NotificationSyncResult | void>(
  userId: string,
  task: () => Promise<T>,
) {
  const previous = syncQueues.get(userId);
  const current = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(task);
  syncQueues.set(userId, current);
  return current.finally(() => {
    if (syncQueues.get(userId) === current) syncQueues.delete(userId);
  });
}

export function synchronizeLocalNotifications(
  userId: string,
  reminders: NativeReminder[],
  notificationsEnabled = true,
): Promise<NotificationSyncResult> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve({ status: "skipped" });

  return enqueueForUser(
    userId,
    () => syncLocalNotifications(userId, reminders, notificationsEnabled),
  );
}

export function cleanNearOrExpiredLocalNotifications(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  return enqueueForUser(userId, () => cleanNearOrExpiredNotifications(userId));
}
