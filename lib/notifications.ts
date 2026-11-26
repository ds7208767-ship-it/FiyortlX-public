import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export type NativeReminder = {
  key: string;
  title: string;
  body: string;
  at: Date;
};

export type NotificationSyncResult =
  | { status: "skipped" }
  | { status: "permission-denied" }
  | { status: "scheduled"; count: number };

const STORAGE_PREFIX = "fiyortx-native-notifications:";
const syncQueues = new Map<string, Promise<NotificationSyncResult>>();

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

async function syncLocalNotifications(
  userId: string,
  reminders: NativeReminder[],
): Promise<NotificationSyncResult> {
  if (!Capacitor.isNativePlatform()) return { status: "skipped" };

  const previousIds = readScheduledIds(userId);
  if (previousIds.length > 0) {
    await LocalNotifications.cancel({
      notifications: previousIds.map((id) => ({ id })),
    });
  }

  if (reminders.length === 0) {
    localStorage.setItem(getStorageKey(userId), "[]");
    return { status: "scheduled", count: 0 };
  }

  const { display } = await LocalNotifications.checkPermissions();
  if (display !== "granted") {
    localStorage.setItem(getStorageKey(userId), "[]");
    return { status: "permission-denied" };
  }

  if (Capacitor.getPlatform() === "android") {
    await LocalNotifications.createChannel({
      id: "fiyortx-reminders",
      name: "Fiyor₺X Hatırlatmaları",
      description: "Sabit kayıt ve kredi kartı günü hatırlatmaları",
      importance: 3,
      visibility: 0,
    });
  }

  const usedIds = new Set<number>();
  const notifications = reminders
    .filter((reminder) => reminder.at.getTime() > Date.now())
    .map((reminder) => ({
      id: notificationId(`${userId}:${reminder.key}`, usedIds),
      title: reminder.title,
      body: reminder.body,
      schedule: { at: reminder.at },
      channelId: "fiyortx-reminders",
      extra: { app: "fiyortx", userId },
    }));

  if (notifications.length === 0) {
    localStorage.setItem(getStorageKey(userId), "[]");
    return { status: "scheduled", count: 0 };
  }

  const result = await LocalNotifications.schedule({ notifications });
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

export function synchronizeLocalNotifications(
  userId: string,
  reminders: NativeReminder[],
): Promise<NotificationSyncResult> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve({ status: "skipped" });

  const previous = syncQueues.get(userId);
  const current = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(
    () => syncLocalNotifications(userId, reminders),
  );
  syncQueues.set(userId, current);

  return current.finally(() => {
    if (syncQueues.get(userId) === current) syncQueues.delete(userId);
  });
}
