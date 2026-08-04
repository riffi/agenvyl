# Local projects

A project is a named local folder that gives agents a preferred place to work.
Register a folder once, then select it when creating a room or from the room's
**Project…** action.

Projects are guidance, not storage or a security boundary:

- the agent process still starts in its isolated room workspace;
- the selected harness and permission profile still decide which paths the
  agent can access;
- agents may use other folders when their permissions and task allow it; and
- workspace versioning, artifacts, and conflict handling continue to apply
  only to the room workspace.

## Register a folder

Open **Projects** from the main navigation, then select **Add project**. Enter a
unique name and either type an absolute path or use **Choose…**. Windows and
macOS use their system folder dialogs. Linux uses Zenity or KDialog when one is
available; manual path entry always remains available.

The Connector verifies that the path is an existing directory and stores its
canonical form. The same folder cannot be registered twice.

## Availability and run history

A folder can become unavailable after registration because it was moved,
renamed, disconnected, or deleted. Agenvyl does not block the run in that case:
the agent continues in the room workspace and receives an explicit notice that
the recommended project is unavailable.

Each run records the project name and path it started with. Changing the room's
project affects future runs only. A retry keeps the original run's project
snapshot and checks that path again before starting.

Deleting a project removes it from every room after confirmation. It does not
delete or modify the local folder.
