# Conversations and notifications

PrimeSecure 0.8.1 (version code 17) adds student support images, structured bug reports and support notifications. The dashboard bell checks for unread student replies and support messages every 20 seconds while the page is visible, and refreshes when the browser regains focus. Each administrator has separate read receipts. Opening a student support conversation marks the loaded student messages read; expanding a student reply marks that reply read. Unopened conversations stay unread.

On the Primebook, the bell combines unread school notices and support replies. Opening support marks only incoming replies actually rendered on screen as read. Android also displays a normal support-reply notification after a successful background sync; Android notification settings and connectivity determine delivery. Notifications open the support conversation. Required school-notice acknowledgement remains separate.

Students can choose an existing image or screenshot, preview it, remove it, and explicitly send it with a support message or bug report. Images are re-encoded as small JPEGs (up to about 74 KB), without EXIF metadata, and remain inside the private school conversation. Use the Primebook screenshot shortcut first, then choose that image. This feature does not capture other applications or take screenshots silently. The existing explicit camera/photo flow remains available. Older agents show upgrade guidance for the new actions.

Bug reports are under **Support → Report a bug**. Categories cover installs, notes, wallpapers, messages, media, network, enrollment and other problems. Reports include a summary, reproduction steps, expected/actual behaviour, optional image, and application/interface versions. They use the durable offline outbox. Administrators can filter **Student support → Message type → Bug reports**, view the reproduction details, reply, and set Open, Reviewing or Resolved.

Students may delete their own sent support messages; school administrators may delete messages in their school's conversations. Deletion clears the text, image and report details and leaves a timestamped “Message deleted” placeholder. Offline copies update after reconnection and sync. The outbox deduplicates retries by request ID, including report submission, deletion and read receipts.

**Settings → Forms & classes** includes class and whole-form deletion with confirmation. Assigned students must first be moved to another group. Deletion retains learning resources and student records. The Rusununguko seed contains the 26 named classes requested from RoboCore; existing additional entries are preserved.

Validation distinguishes local database authorization/retry tests, desktop browser tests with a native bridge stub, live dashboard/database checks, and APK build/signature checks. Android image-picker behaviour, notification appearance and offline delivery need a physical Primebook pilot before fleet rollout.
