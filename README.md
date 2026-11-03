# Vector Lab

Vector Lab is a dependency-free physics playground with five ready-to-run
simulations: a force lab, gravity-driven orbits, projectile motion, a pendulum,
and a collision lab. Add or move bodies, change their properties, and watch
energy and motion telemetry update as each simulation runs.

## Run it

Open `index.html` in a modern browser. No build step or package installation is
required.

Open the page in multiple tabs in the same browser to see edits and simulation
state synchronize live. Collaboration uses the browser's `BroadcastChannel`
API; it is local to tabs on the same origin and does not connect users across
devices.

Use **Export** to download a scene as JSON, import a saved JSON scene, or copy a
JavaScript simulation snippet.

## Controls

- Select a simulation card to load a force, orbit, projectile, pendulum, or
  collision example.
- Drag bodies to reposition them; in the force lab, drag the cyan handle to
  change applied force.
- Select a body to adjust its mass and available simulation parameters.
- Use the play/pause button to run or stop the simulation; choose half, normal,
  or double speed and toggle motion trails or force vectors.
- Add bodies where supported, or reset the active simulation to its starter
  scene.
- Use **Enter** to launch a projectile or release a pendulum, **Space** to play
  or pause, **A** to add a body, and **Esc** to close the export menu.
