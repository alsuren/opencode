import type { Platform } from "@opencode/app/desktop"
import type { ElectronAPI } from "../api-types"

export function createDesktopNotifications(api: ElectronAPI): Pick<Platform, "notify" | "closeNotifications"> {
  const tagged = new Map<string, Notification>()
  return {
    async notify(title, description, onClick, tag) {
      const focused = await api.getWindowFocused().catch(() => document.hasFocus())
      if (focused) return

      if (tag) tagged.get(tag)?.close()
      const notification = new Notification(title, {
        body: description ?? "",
        icon: "https://opencode.ai/favicon-96x96-v3.png",
        silent: true,
        tag,
      })
      if (tag) tagged.set(tag, notification)
      notification.onclick = () => {
        void api.showWindow()
        void api.setWindowFocus()
        onClick?.()
        notification.close()
      }
      notification.onclose = () => {
        if (tag && tagged.get(tag) === notification) tagged.delete(tag)
      }
    },
    async closeNotifications(match) {
      tagged.forEach((notification, tag) => {
        if (match(tag)) notification.close()
      })
    },
  }
}
