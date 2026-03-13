import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import { dataParseTool } from "../../src/data-parse.js";

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
  },
}));

describe("data_parse tool", () => {
  it("should parse JSON string", async () => {
    const result = await dataParseTool.execute({
      input: '{"key":"value"}',
      format: "json",
    });

    expect(result).toEqual({ key: "value" });
  });

  it("should parse CSV string", async () => {
    const csv = "name,age\nAlice,30\nBob,25";
    const result = (await dataParseTool.execute({
      input: csv,
      format: "csv",
    })) as Array<Record<string, string>>;

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "Alice", age: "30" });
    expect(result[1]).toEqual({ name: "Bob", age: "25" });
  });

  it("should support preview mode for arrays", async () => {
    const json = JSON.stringify([1, 2, 3, 4, 5]);
    const result = await dataParseTool.execute({
      input: json,
      format: "json",
      preview: 2,
    });

    expect(result).toEqual([1, 2]);
  });

  it("should read from file when fromFile is true", async () => {
    vi.mocked(fs.readFile).mockResolvedValue('{"fromFile":true}');

    const result = await dataParseTool.execute({
      input: "/tmp/data.json",
      format: "json",
      fromFile: true,
    });

    expect(result).toEqual({ fromFile: true });
    expect(fs.readFile).toHaveBeenCalledWith("/tmp/data.json", "utf-8");
  });

  it("should throw on unsupported format", async () => {
    await expect(dataParseTool.execute({ input: "data", format: "xml" })).rejects.toThrow(
      "Unsupported format: xml",
    );
  });

  it("should handle empty CSV", async () => {
    const result = await dataParseTool.execute({
      input: "",
      format: "csv",
    });

    expect(result).toEqual([]);
  });
});
