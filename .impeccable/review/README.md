# Visual review artifacts

The PNG files in this directory are human-review captures of the LedgerLink
interface at commit `13f68e2`. They document the redesign across desktop,
mobile, dark mode, dialogs, and representative feature states.

They are deliberately stored as design-review artifacts, not pixel-test
baselines: the captures contain seeded application data and authenticated UI
state that is not yet reproduced by a deterministic browser fixture. Do not
silently treat them as current screenshots after changing the interface.

When refreshing the set:

1. Use the same seeded organization and browser zoom for every screen.
2. Capture desktop at 1440 px wide and mobile at 390 px wide unless the file
   name documents a different purpose.
3. Review keyboard focus, overflow, empty/loading/error states, and both color
   themes before replacing an artifact.
4. Commit the UI change and its refreshed captures together.

Once a deterministic authenticated fixture exists, promote the stable states
to visual-regression tests and keep exploratory captures here.
