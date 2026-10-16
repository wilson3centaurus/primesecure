# Learning library and update retries

PrimeSecure 0.8.5 (install code 22) retries failed native updates after five minutes. A network-constrained WorkManager retry survives reboots; online check-ins also retry when the delay expires. A newer release is attempted immediately. Offline devices wait for connectivity. This fix takes effect after the new APK is installed; it cannot change the six-hour timer inside an already-installed older APK.

Students: School Notes > Request learning materials. Select Book, Notes, Past exam papers, Novel, Textbook, Images or Other resources, add a title, form, subject and details. Requests persist in the device outbox offline and appear in Background tasks. Recent requests and review status are shown in School Notes after sync. Administrators review them in Content & files > Learning requests. Approving a request does not invent or automatically download copyrighted material; upload the approved file to the library.

Administrators: Content & files > School notes > Manage folders. Create form, subject and resource folders, rename a folder and its contained metadata, or delete an empty folder and its empty descendants. Nonempty folders cannot be deleted. School-level staff manage only their school; RoboKorda administrators explicitly choose school or shared scope. Shared and school folders with the same name can appear as one combined browsing path, but changes affect only the chosen scope.

Open a resource folder > Move or copy. Select a destination and Move original or Copy to school. Create the destination first. A copy duplicates the private Storage object and creates a new school-owned library entry; the original is retained. A school administrator cannot move a shared original. Renaming/moving a resource does not re-upload its bytes. The hierarchy remains Form / Subject / Resource folder.

Database migration: 20261016200912_learning_library_management.sql. It preserves existing files, adds learning request metadata and explicit empty folders, and retains school and device row-level permissions. Native build and automated checks do not replace a physical PrimeOS pilot.
