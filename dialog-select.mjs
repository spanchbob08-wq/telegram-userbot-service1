export function findDialogEntity(dialogs, targetId) {
  const wanted = String(targetId);
  for (const dialog of dialogs || []) {
    if (String(dialog?.id) === wanted && dialog?.entity) return dialog.entity;
  }
  return null;
}
