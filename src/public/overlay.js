const container = document.getElementById('comments');
const maxComments = 8;
const displayDuration = 20_000;

function addComment(comment) {
  if (comment.type !== 'comment') return;
  const item = document.createElement('article');
  item.className = `comment ${comment.visitor.platform.toLowerCase()}`;

  const meta = document.createElement('header');
  const platform = document.createElement('span');
  platform.className = 'platform';
  platform.textContent = comment.visitor.platform;
  const author = document.createElement('span');
  author.className = 'author';
  author.textContent = comment.visitor.authorName;
  meta.append(platform, author);

  const text = document.createElement('p');
  text.textContent = comment.visitor.text;
  item.append(meta, text);
  container.prepend(item);
  while (container.children.length > maxComments) container.lastElementChild.remove();
  window.setTimeout(() => item.remove(), displayDuration);
}

new EventSource('/events').addEventListener('chat', (event) => addComment(JSON.parse(event.data)));
