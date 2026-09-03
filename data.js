// Promptly — starter data.
// Prompts and categories now live in localStorage and are managed by the user
// via the in-app "+ Add prompt" editor. Defaults below are empty; the app
// seeds "All" plus a handful of starter categories on first run and the user
// can add / rename / delete freely.

window.PROMPTS = [];

window.CATEGORIES = [
  { id: 'all', name: 'All', emoji: '✨' },
];

// One-time cleanup: these premade categories used to be seeded by default.
// If a user has any of these still sitting in localStorage AND no prompts use
// them, we quietly remove them so the rail only shows what the user actually added.
window.PROMPTLY_LEGACY_PREMADES = ['Portraits','Fashion','Landscapes','Architecture','Abstract'];
