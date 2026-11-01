# Gibberish — Product Requirements Document

**Version:** 1.1  
**Product:** Gibberish  
**Platform:** Progressive Web App (PWA)  
**Status:** Approved MVP requirements — technical specifications pending

---

## 1. Product Overview

Gibberish is a privacy-first personal journaling application designed to provide a secure space for users to express their most private thoughts, feelings, experiences, and secrets.

Users write journal entries naturally in English. Once saved, entries are encrypted locally and displayed in a unique, fictional, pronounceable language called Gibberish.

The original text is revealed only when the user explicitly requests it and their journal is unlocked.

Gibberish combines client-side encryption, local-first storage, and an intentionally unreadable default reading experience.

Users can journal without creating an account or connecting to Google Drive. Google Drive integration is optional and provides encrypted backup and synchronization.

## 2. Product Vision

To create a personal journaling experience where people can express themselves freely, retain ownership of their data, and control when their private thoughts become readable.

### Core Principles

1. **Privacy by design:** Journal content is encrypted before being persisted.
2. **User ownership:** Journal data is stored locally, with optional storage in the user's Google Drive.
3. **Local-first:** Users can write and access locally available entries without internet connectivity.
4. **Intentional disclosure:** Entries display as Gibberish unless explicitly revealed.
5. **Simplicity:** The application should feel calm, intuitive, and distraction-free.
6. **Portability:** Users can export encrypted backups and recover their journals.
7. **Transparency:** Users must understand whether their entries are locally saved, backed up, or awaiting synchronization.

## 3. Target Users

Gibberish is intended for individuals who want a private space to document personal thoughts and experiences without worrying about casual observation or unauthorized access.

The MVP prioritizes individual users.

Shared journals, social features, and collaboration are excluded.

## 4. Primary User Journey

1. The user opens Gibberish in a browser or from their device's home screen.
2. The user creates a journal passphrase.
3. Gibberish prepares keys/wrappers in memory, displays a separate recovery key,
   and requires full-key confirmation plus explicit saved/loss acknowledgment
   before committing local journal initialization. The key unlocks existing data;
   it does not back up journal data lost from browser storage.
4. The user chooses whether to connect Google Drive or continue with local-only storage.
5. The user creates a journal entry in English.
6. Gibberish encrypts the entry locally before persistence.
7. The saved entry appears in fictional Gibberish.
8. The user selects **Reveal My Thoughts** to view the original English.
9. The user selects **Hide My Thoughts** to return to Gibberish.
10. If Google Drive is connected, encrypted changes synchronize when connectivity is available.
11. The journal automatically locks after five minutes of inactivity.

On subsequent visits, users must unlock their journal before viewing entries or journal metadata.

## 5. MVP Functional Requirements

### FR-01: Optional Google Authentication

- Users must be able to create and use a journal without Google authentication.
- Google sign-in must be available when users choose to connect Google Drive.
- Google authentication and journal unlocking must remain separate operations.
- Google authentication must not automatically expose journal plaintext.
- Users must be able to disconnect their Google account without deleting their locally stored journal.
- Google authentication failures must not prevent local journaling.

### FR-02: Local-First Storage and Optional Google Drive

**Local Journal Creation**

- Users must be able to create and use a journal without connecting Google Drive.
- Users must create a journal passphrase before saving their first entry.
- Journal entries must be encrypted locally before persistence.
- Encrypted entries must be stored in IndexedDB.
- Users must be able to create, read, edit, delete, and restore locally available entries without internet connectivity.
- Users must be able to export an encrypted backup without connecting Google Drive.

**Optional Google Drive Connection**

- Users must be able to connect Google Drive during onboarding or later through Settings.
- Users must explicitly authorize access to the required application files.
- Gibberish must create or locate a dedicated journal folder in the user's Google Drive.
- Gibberish must provision the required Google Sheets storage file.
- Users must retain ownership of their cloud-stored journal files.
- Only encrypted journal data and required non-secret metadata may synchronize.
- Users must be able to disconnect Google Drive without losing their local journal.
- Temporary Google Drive failures must not interrupt local journaling.

**Backup Awareness**

- Gibberish must clearly distinguish between locally saved, awaiting synchronization, and cloud-backed-up entries.
- Local-only users must be warned that clearing browser data, losing their device, or removing locally stored application data may result in permanent journal loss.
- The application must encourage encrypted backup exports for users who do not connect Google Drive.
- Locally saved entries must never be described as cloud-backed up.
- Synchronization failures must be visible without interrupting local journal operations.

### FR-03: Journal Passphrase, Recovery, and Unlocking

**Passphrase Setup**

- Users must create a journal passphrase during initial setup.
- The passphrase must protect access to the journal's encryption key.
- Journal unlocking must occur locally.
- Google authentication alone must not decrypt journal entries.

**Recovery Key**

- Gibberish must generate a separate recovery key during onboarding.
- Users must be instructed to save the recovery key securely.
- The recovery key must provide an alternative way to regain access if the journal passphrase is forgotten.
- Recovery must not require an email-based password reset.
- Gibberish must clearly explain that losing both the passphrase and recovery key may make the journal permanently inaccessible.
- The recovery mechanism must be defined and verified in the security specification.

**Locked Journal Behavior**

- Gibberish must open in a fully locked state unless a valid unlocked session remains active.
- While locked, the application must not display journal entries, titles, dates, timeline information, or Gibberish representations.
- The locked interface must not reveal journal content or sensitive metadata.
- Unlocking must require the journal passphrase or approved recovery mechanism.
- Locking must clear decrypted content and accessible key material from application memory as far as the browser environment permits.
- Users must be able to lock their journal manually at any time.

**Automatic Journal Locking**

- The journal must automatically lock after five consecutive minutes of user inactivity.
- The inactivity timer must reset when the user interacts with the application.
- The application must check elapsed inactivity time when returning from the background rather than relying solely on browser timers.
- Revealed English must be hidden immediately when the application enters the background, even if the full journal has not yet locked.
- Once locked, the user must unlock the journal again to access its contents.

### FR-04: Create Journal Entry

Users must be able to:

- Create a new journal entry.
- Enter a title and body in English.
- Save the entry.
- Receive confirmation when the encrypted entry has been saved locally.
- Continue writing while offline.

Journal plaintext must not be persisted unencrypted.

### FR-05: Gibberish Display

- Saved journal entries must display as fictional, pronounceable Gibberish by default.
- Gibberish must be generated from encrypted data using a reversible codec.
- The representation must not reveal original English through simple word substitution.
- The application must support decoding the representation back into the encrypted bytes needed for decryption.
- The Gibberish codec must not be treated or presented as encryption.
- The MVP must use one standardized Gibberish language.

### FR-06: Reveal and Hide

- Users must be able to select **Reveal My Thoughts** to view the original English entry.
- Users must be able to select **Hide My Thoughts** to return to Gibberish.
- Revealing an entry must require an unlocked journal.
- Revealed content must be hidden when navigating away, locking the journal, or when the application detects that it has entered the background.
- Revealed plaintext must not be persisted to browser storage.
- Revealing one entry must not automatically reveal other entries.

### FR-07: Journal Timeline and Title Privacy

- The journal timeline must be accessible only after unlocking.
- Each entry must display its title in fictional Gibberish by default.
- Original English titles must not appear in the timeline by default.
- Original titles must only become visible through an explicit Reveal action.
- Both titles and bodies must be encrypted before local or cloud persistence.
- Gibberish titles must be derived from encrypted data using the reversible codec.
- Users must be able to open entries from the timeline.
- Entries must be displayed in reverse chronological order, newest first.
- Sole-head trashed entries must not appear in the main timeline. A conflicting
  entry with active and trashed heads remains visible with all branches; M4
  does not select a winning branch or resolve conflicts.
- Each entry must communicate its synchronization status without exposing plaintext.

### FR-08: Edit Journal Entry

- Users must be able to edit existing entries while their journal is unlocked.
- Edited content must be encrypted before persistence.
- Changes must update the entry's modification timestamp.
- Edits must synchronize when Google Drive is connected and connectivity is available.
- Failed synchronization must not discard locally saved edits.

### FR-09: Journal Deletion and Recovery

- Users must be able to move entries to Trash after confirming deletion.
- Trashed entries must disappear from the main timeline immediately.
- Trashed entries must remain encrypted locally and, when connected, in cloud storage.
- Users must be able to view and restore entries from Trash while unlocked.
- Each trashed entry must have a deletion timestamp.
- Unless explicitly permanently deleted, entries are retained for 30 elapsed
  days from the current authenticated Trash revision. After that they become
  eligible for bounded cleanup during subsequent visible, authorized use.
- Restoration may succeed after expiry while ciphertext remains and no permanent
  deletion has committed. It is not a guaranteed grace period. Device-clock
  anomalies defer automatic deletion; closed-app elapsed time cannot be proven.
- Users must be able to permanently delete an entry from Trash before the retention period expires.
- Deletion and restoration must synchronize across connected devices.
- Failed deletion operations must be retried without silently restoring deleted entries.
- The interface must distinguish between moving an entry to Trash and permanently deleting it.
- Automatic deletion cannot be guaranteed at the exact 30-day expiration time when the application is not running.
- Permanent deletion from active storage does not guarantee removal from historical backups or Google-managed file revisions.

### FR-10: Offline Functionality

- Users must be able to create, view, edit, delete, and restore locally available entries while offline, subject to unlocking.
- The application must persist encrypted entries locally.
- Pending changes must be queued for synchronization when Google Drive is connected.
- Users must receive clear feedback about unsynchronized changes.
- The application must not imply that unsynchronized data has been backed up.
- Previously cached application resources must allow offline launching after successful initial setup.
- The application must clearly communicate local storage failures or insufficient storage.

### FR-11: Synchronization

- Google Drive synchronization must be optional.
- When enabled, encrypted journal entries must synchronize through the configured Google Drive and Google Sheets storage.
- Synchronization must resume after temporary network failures.
- The application must prevent silent data loss or overwriting when conflicts occur.
- Users must be able to see the latest known synchronization status.
- The application must provide a manual **Sync Now** action.
- The application must distinguish local-only entries from entries awaiting cloud synchronization.
- Disconnecting Google Drive must stop cloud synchronization without deleting local journal content.
- Automatic background synchronization must not be assumed to work reliably on every browser.
- Synchronization must be retried when the application is opened or connectivity is restored, where supported.
- Simultaneous conflicting edits must not be silently merged or overwritten.

### FR-12: Journal Export and Recovery

Gibberish must provide two export options.

**Encrypted Backup**

- Users must be able to export their journal as an encrypted backup.
- The backup must include the information required for restoration, including encryption metadata and version information.
- The backup must not contain plaintext titles or bodies.
- Restoration must require the appropriate journal passphrase or recovery credentials.
- The application must verify backup integrity and compatibility before restoration.
- Users must be able to restore their journal on another supported device.
- Export must be available without Google Drive.

**Readable English Export**

- Users must be able to export their journal in readable English after unlocking.
- The MVP must support Markdown (`.md`) as the readable export format.
- The application must display a privacy warning before generating a readable export.
- Users must explicitly confirm that they understand the exported file is not encrypted.
- The export must include original English titles, bodies, and relevant dates.
- Readable exports must be generated locally without uploading plaintext to a server.
- Exporting must not modify the journal's encrypted storage.
- Plaintext export data must not be retained in persistent application storage.

**Export Security**

- Export actions must be unavailable while locked.
- Exports must not include OAuth tokens, encryption keys, or passphrases.
- Export failures must not corrupt journal data.
- The interface must clearly distinguish encrypted backups from readable exports.
- Users must be warned that anyone who obtains a readable export may access its contents.

### FR-13: PWA Installation

- Gibberish must be installable on supported mobile and desktop browsers.
- The application must provide an app icon and standalone display configuration.
- Previously cached application resources must support offline launch.
- Application updates must not silently discard unsynchronized journal changes.
- The application must provide installation guidance where appropriate.

## 6. Non-Functional Requirements

### Security

- Encryption and decryption must occur client-side.
- Journal plaintext and unwrapped encryption keys must never be uploaded to Google Drive.
- Encrypted key-recovery material may be stored when necessary for secure restoration.
- Sensitive information must not appear in logs or analytics.
- The application must mitigate common web security vulnerabilities.
- Encryption, recovery, locking, and export behavior must be covered by automated tests.
- Browser and device compromise remain outside the application's absolute security guarantees.

### Reliability

- Local writes must complete successfully before being reported as saved.
- Temporary synchronization failures must not discard local changes.
- Conflicts must be handled explicitly.
- Users must be warned about unsynchronized data.
- Storage failures must be reported rather than silently ignored.

### Performance

- Common journal actions should feel responsive on typical mobile devices.
- The application should remain usable as journal entries accumulate.
- Synchronization should minimize unnecessary Google API requests.

### Accessibility

- The interface must support keyboard navigation.
- Interactive controls must have accessible labels.
- Text and controls must meet appropriate contrast requirements.
- Reveal and Hide must not depend solely on colors or icons.

### Usability

- The interface must be mobile-first.
- Writing and reading must remain the primary focus.
- Encryption and synchronization concepts must be explained in understandable language.
- Privacy warnings must be clear without unnecessarily interrupting normal journaling.

## 7. MVP Screens

1. Welcome / Get Started
2. Journal Passphrase Setup
3. Recovery Key Setup
4. Optional Google Drive Connection
5. Journal Unlock
6. Journal Timeline
7. New Journal Entry
8. Entry Detail / Reveal and Hide
9. Edit Entry
10. Encrypted Trash
11. Settings / Backup and Sync Status
12. Export and Restore Journal

## 8. Out of Scope for MVP

- Multiple personalized Gibberish languages
- AI-generated writing prompts or journal analysis
- Social sharing and collaborative journals
- Photos, videos, and audio attachments
- Mood tracking and analytics
- Rich-text editing
- Push notifications
- Native iOS and Android applications
- Subscription and payment systems
- Custom application backend
- Email-based journal passphrase resets
- Multiple cloud storage providers
- Real-time collaboration
- Automatic merging of simultaneous conflicting edits
- Complex multi-account journal management

## 9. MVP Success Criteria

The MVP is ready for initial testing when:

1. A user can create an encrypted journal without a Google account.
2. A user can create, edit, and delete journal entries locally.
3. The journal remains fully locked until the user provides the correct passphrase or recovery credentials.
4. The journal automatically locks after five minutes of inactivity.
5. Saved entries display as Gibberish by default, including timeline titles.
6. Users can explicitly reveal and hide original English content.
7. Users can restore entries from encrypted Trash within 30 days.
8. Users can export an encrypted backup.
9. Users can explicitly export readable English entries after unlocking and accepting a privacy warning.
10. Users can connect Google Drive optionally and synchronize encrypted entries.
11. Offline journaling works after successful initial setup.
12. A user can restore their journal on another supported device using an encrypted backup or available cloud data and the appropriate recovery credentials.
13. Synchronization failures and conflicts do not silently discard entries.
14. Automated functionality, security, recovery, and offline tests pass.

## 10. Confirmed Product Decisions

| Area | Decision |
|---|---|
| Platform | React + TypeScript PWA |
| Primary storage | Local encrypted IndexedDB |
| Cloud storage | Optional Google Drive and Google Sheets |
| Google authentication | Optional; required only for cloud connection |
| Journal access | Fully locked until passphrase or recovery unlock |
| Automatic locking | Five minutes of inactivity |
| Default entry display | Fictional Gibberish |
| Timeline titles | Gibberish |
| Encryption | Client-side authenticated encryption |
| Gibberish transformation | Reversible encoding of encrypted data |
| Deletion | Encrypted Trash with 30-day retention |
| Backup | Encrypted export |
| Readable export | Markdown after unlock and privacy confirmation |
| Recovery | Separate recovery key |
| Backend | No custom backend for MVP |

## 11. Technical Specifications to Be Defined

The following details belong in subsequent technical documentation and must be resolved before implementing dependent functionality:

- Encryption format, key derivation, key wrapping, and recovery-key lifecycle
- Gibberish codec specification and versioning
- Local IndexedDB schema
- Google Drive folder and Sheets data model
- Offline synchronization, conflict detection, and deletion propagation
- Browser storage and PWA lifecycle handling
- Security testing and recovery validation

These are technical design requirements, not additional product-scope decisions.

## 12. Document Governance

This PRD defines Gibberish MVP behavior, user experience, and scope.

Implementation details belong in `SECURITY.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `SYNC_STRATEGY.md`, and `TESTING.md`.

Changes to MVP scope must be reviewed and reflected in the implementation plan before Codex begins dependent work.

## M3 approved behavior (2026-10-31)

Onboarding prepares keys/wrappers in memory, displays the independent recovery
key, requires full-key confirmation and explicit acknowledgment before atomic
initialization. New passphrases require at least 15 Unicode code points, nonblank
well-formed UTF-8, exact confirmation and at most 1,024 UTF-8 bytes. No trimming,
normalization or truncation; existing shorter passphrases remain valid on unlock.
A recovery key unlocks existing ciphertext and is not a backup of deleted data.

Hidden pages immediately clear plaintext UI, revealed content and unsealed drafts.
Only private authorized/setup capabilities survive until their original five-minute
inactivity deadline. Concealed is not locked. Manual lock, expiry and pagehide
fully revoke, per tab. Resume checks the original deadline before activity/view
restoration; English and drafts never automatically return. Warn before writing
that switching apps/tabs can discard unsaved text.

Recovery-key authentication and recovery-driven passphrase reset are M3. Default
views use an eight-word preview of the authenticated single title/body envelope
and complete reversible Gibberish detail with bounded paging. Previews are labelled
incomplete. Reveal is required before reading/editing stored English; new-entry
authoring remains English. Conflicts are preserved with readonly branch access,
not resolved. Local save confirmation requires verified committed persistence.
See [M3_EXPERIENCE.md](M3_EXPERIENCE.md) for exact boundary/lifecycle contracts.


## M4 approved implementation contract

Decisions A–G Option 1 are approved. [M4_LIFECYCLE.md](M4_LIFECYCLE.md) defines
the precise lifecycle, authenticated marker/backup formats, database v2 migration,
retention, restoration, download and passphrase-change contracts. These supersede
older draft tombstone/backup shapes and M2-only lifecycle exclusions. Revision/AAD
v2, wrapping v1, codec v1 and the five-minute M3 privacy policy remain unchanged.
