# Local projects

A project is a named local folder that gives agents a preferred place to work.
Register a folder once, then select it with **Add project** when creating a room
or from the room's **Project…** action.

An available selected project is the execution working directory in both
**Plan** and **Work**. Plan uses it for read-only exploration; Work applies
changes directly to it. Without an available project, executions use the
room's shared Git-backed Workspace.

Selecting a project is not a blanket permission grant:

- the selected harness and permission profile still decide which paths the
  agent can access;
- agents may use other folders when their permissions and task allow it; and
- Workspace versioning and captured artifacts apply only to the room Workspace.

Work agents are serialized within one room. Plan agents in that room and runs
from different rooms can execute concurrently. Two concurrent runs that can
write the same external project can therefore race. Use Work in one room for
coordinated changes or otherwise protect the external repository yourself.

### Harness access requirements

| Harness | Selected project behavior and access |
| --- | --- |
| Codex CLI | The project is passed as `cwd`. Plan forces a read-only sandbox, including when **Full access** is selected; Work uses the selected permission profile. |
| OpenCode | The session is rooted in the project. Native Plan enforcement and the selected permission profile still apply; unrelated external directories need separate authorization. |
| Claude Code | Claude's selected permission mode and any runtime approval must permit the operation. Agenvyl does not pre-authorize the project path. |
| Antigravity / AGY | The instance and workflow mode remain authoritative; selecting a project does not enable edits. |
| Cursor CLI | Agenvyl starts Cursor in the execution working directory and instructs it to stay there. Plan uses Cursor's native planning mode. |
| Hermes | Access depends on the connected Hermes server and its tools; Agenvyl does not mount or grant the local path. |

Registering or selecting a project therefore does not prove that every agent in
the room can read it. Configure and test each harness separately, and keep
managed attachments and response artifacts in the room workspace.

## Register a folder

Open **Projects** from the main navigation, then select **Add project**. Enter a
unique name and either type an absolute path or use **Choose…**. Windows and
macOS use their system folder dialogs. Linux uses Zenity or KDialog when one is
available; manual path entry always remains available.

The Connector verifies that the path is an existing directory and stores its
canonical form. The same folder cannot be registered twice.

## Browse project files and the current build

With a project attached, the room's **Workspace** button opens the project on
first use. The source selector in the upper left switches between the project
and **Room workspace**. **App preview / Files** works in both sources. Agenvyl
remembers the last source and view for that room and project in your browser.
Opening a message attachment still opens its saved workspace version.

The project tree reads files through Connector, loads directories as you expand
them, and refreshes open directories and the selected file every three seconds.
It is a read-only browser: Download and Attach are available, but file mutations,
Trash, history and restores belong to Room workspace. Attach copies the bytes
at that moment into an immutable workspace version. Later project edits do not
change the message attachment. No project Git commits are created.

App preview serves the current static files directly from the project. It uses
the same `dist`, `build`, `out` and plain HTML discovery rules as Workspace.
Equally ranked builds are offered for selection. The actions menu's **Build
settings…** lets you choose another relative HTML path and override the build
command; clear either field to restore automatic detection. Settings belong to
the project and are shared across rooms.

**Build now** runs the detected `package.json` build script (using the package
manager field or lockfile) or your configured command directly in the project
through Connector. It does not invoke an agent. The log shows progress, success
or failure and offers cancellation. Only one manual build runs per project;
builds time out after ten minutes. Logs are bounded and last until Connector
restarts. Opening a preview never starts a build. Refresh reloads the preview;
it also refreshes when a room agent finishes or a manual build ends.

There is no build history or development-server management for projects. During
a build, files are changing on disk; refresh the preview when the build ends.
An inaccessible project shows an error rather than displaying Workspace files
under the project's name. Files larger than 32 MiB cannot be opened or attached.
Git internals and symbolic links are excluded. Auto-detection scans at most
10,000 entries and six directory levels, skipping dependency/cache folders;
use a manual HTML path when a project exceeds those limits. Individual folders
show at most 2,000 entries, with a notice when truncated.

## Availability and run history

A folder can become unavailable after registration because it was moved,
renamed, disconnected, or deleted. Agenvyl does not block the run in that case:
the agent continues in the room workspace and receives an explicit notice that
the recommended project is unavailable.

Each run records the project name and path it started with. Changing the room's
project affects future runs only. The next message starts a fresh agent session
with the current project and room history instead of resuming the previous
project's session. Queued follow-ups also use the current project when they
start; running tasks keep their original project. A retry keeps the original run's project
selection and checks that path again before starting.

Deleting a project removes it from every room after confirmation. It does not
delete or modify the local folder.
