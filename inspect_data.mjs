//  import fetch from 'node-fetch'; // Built-in in Node 22

async function inspect(url) {
    const res = await fetch(url);
    const data = await res.json();
    console.log(`URL: ${url}`);
    console.log(`Type: ${Array.isArray(data) ? 'Array' : typeof data}`);
    console.log(`Length: ${data.length}`);
    console.log('First 3 items:', JSON.stringify(data.slice(0, 3), null, 2));
}

(async () => {
    await inspect('https://a.windbornesystems.com/treasure/00.json');
    await inspect('https://a.windbornesystems.com/treasure/01.json');
})();
