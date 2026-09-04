import { describe, expect, it } from "vitest";
import { parseYoutubeUrl } from "./validate";

describe("parseYoutubeUrl", () => {
  it("rozpoznaje standardowy link watch", () => {
    expect(parseYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      kind: "video",
      id: "dQw4w9WgXcQ",
    });
  });

  it("rozpoznaje link bez protokołu i www", () => {
    expect(parseYoutubeUrl("youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      kind: "video",
      id: "dQw4w9WgXcQ",
    });
  });

  it("rozpoznaje youtu.be", () => {
    expect(parseYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      kind: "video",
      id: "dQw4w9WgXcQ",
    });
  });

  it("rozpoznaje /shorts/", () => {
    expect(parseYoutubeUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toEqual({
      kind: "video",
      id: "dQw4w9WgXcQ",
    });
  });

  it("rozpoznaje music.youtube.com", () => {
    expect(parseYoutubeUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      kind: "video",
      id: "dQw4w9WgXcQ",
    });
  });

  it("rozpoznaje playlistę", () => {
    const result = parseYoutubeUrl(
      "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
    );
    expect(result?.kind).toBe("playlist");
  });

  it("watch z &list= traktowany jako pojedyncze wideo, nie playlista", () => {
    const result = parseYoutubeUrl(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
    );
    expect(result).toEqual({ kind: "video", id: "dQw4w9WgXcQ" });
  });

  it("ignoruje parametry t/si/feature/pp", () => {
    expect(
      parseYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&si=abc&feature=share"),
    ).toEqual({ kind: "video", id: "dQw4w9WgXcQ" });
  });

  it("odrzuca pusty string", () => {
    expect(parseYoutubeUrl("")).toBeNull();
    expect(parseYoutubeUrl("   ")).toBeNull();
  });

  it("odrzuca nie-YouTube host", () => {
    expect(parseYoutubeUrl("https://vimeo.com/12345678")).toBeNull();
  });

  it("odrzuca niepoprawny URL", () => {
    expect(parseYoutubeUrl("not a url at all")).toBeNull();
  });

  it("odrzuca watch bez v=", () => {
    expect(parseYoutubeUrl("https://www.youtube.com/watch")).toBeNull();
  });

  it("odrzuca zbyt krótkie id wideo", () => {
    expect(parseYoutubeUrl("https://www.youtube.com/watch?v=short")).toBeNull();
  });

  it("odrzuca stronę główną youtube.com", () => {
    expect(parseYoutubeUrl("https://www.youtube.com/")).toBeNull();
  });

  it("odrzuca link do kanału", () => {
    expect(parseYoutubeUrl("https://www.youtube.com/@SomeChannel")).toBeNull();
  });
});
