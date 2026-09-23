/** Follow the same progressive toolbar overflow a user sees. Returns the focus return target. */
export async function clickLogAction(page, name) {
  const action = page.getByRole("button", { name, exact: true }).filter({ visible: true });
  if (await action.count()) { await action.click(); return action; }
  const more = page.getByRole("button", { name: /^(更多操作|更多日志操作)$/ }).filter({ visible: true });
  await more.click();
  await action.click();
  return more;
}
