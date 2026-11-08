// The one genre list as the API serves it (28 genres), and the tag lookup that gives each key its id.
export const GENRES = [
  ["fantasy", "Fantasy", "fiction"], ["science_fiction", "Science fiction", "fiction"], ["mystery_crime", "Mystery & crime", "fiction"], ["thriller", "Thriller", "fiction"],
  ["horror", "Horror", "fiction"], ["romance", "Romance", "fiction"], ["historical_fiction", "Historical fiction", "fiction"], ["literary_fiction", "Literary fiction", "fiction"],
  ["classics", "Classics", "fiction"], ["young_adult", "Young adult", "fiction"], ["childrens", "Children's", "fiction"], ["humor", "Humour", "fiction"],
  ["poetry", "Poetry", "fiction"], ["drama", "Drama & plays", "fiction"], ["short_stories", "Short stories", "fiction"],
  ["graphic_novels", "Graphic novels & comics", "nonfiction"], ["biography_memoir", "Biography & memoir", "nonfiction"], ["history", "History", "nonfiction"],
  ["science_nature", "Science & nature", "nonfiction"], ["business_money", "Business & money", "nonfiction"], ["self_help", "Self-help", "nonfiction"],
  ["psychology", "Psychology", "nonfiction"], ["philosophy_religion", "Philosophy & religion", "nonfiction"], ["christian_faith", "Christian & faith", "nonfiction"],
  ["politics_society", "Politics & society", "nonfiction"], ["travel", "Travel", "nonfiction"], ["food_cooking", "Food & cooking", "nonfiction"], ["art_music", "Art & music", "nonfiction"],
].map(([key, label, group]) => ({ key, label, group }));
export const genreId = key => 500 + GENRES.findIndex(genre => genre.key === key);

// Registered after a fixture's own catch-all route, so it answers these two paths. `state.genresFail` makes the list fail; `state.genresWithIds` adds each genre's tag id to the list.
export async function installGenres(page, state = {}, { batch = true } = {}) {
  await page.route(url => (batch ? /\/test-api\/(genres|autocomplete\/tags\/batch)$/ : /\/test-api\/genres$/).test(url.pathname), route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/genres")) {
      state.genreRequests = (state.genreRequests || 0) + 1;
      return state.genresFail ? route.fulfill({ status: 503, json: { detail: "down" } }) : route.fulfill({ status: 200, json: state.genresWithIds ? GENRES.map(genre => ({ ...genre, id: genreId(genre.key) })) : GENRES });
    }
    const names = url.searchParams.getAll("name");
    return route.fulfill({ status: 200, json: names.filter(name => GENRES.some(genre => genre.key === name)).map(name => ({ id: genreId(name), name, type: "genre" })) });
  });
}
