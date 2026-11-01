import { describe,expect,it,vi } from "vitest";
import { planRevision, referenceForRevision } from "../src/server/ai/revision";
import { revisionSheetPrompt } from "../src/server/pipeline/prompts/sheet";
const context={description:"A green knight",note:"Make the cape shorter",hasLatest:true,hasOriginalUpload:true};
describe("revision planning",()=>{
  it.each(["edit_latest","new_sheet"] as const)("accepts a validated AI choice: %s",async path=>{
    const chat=vi.fn().mockResolvedValue({text:JSON.stringify({path,reason:"Requested change"})});
    expect(await planRevision({chat},context)).toEqual({path,reason:"Requested change"});
    expect(JSON.parse(chat.mock.calls[0][0].messages[0].content)).toEqual(context);
  });
  it("does not call AI when no usable latest image exists or no note was entered",async()=>{
    const chat=vi.fn();
    expect((await planRevision({chat},{...context,hasLatest:false})).path).toBe("new_sheet");
    expect((await planRevision({chat},{...context,note:" "})).path).toBe("new_sheet");
    expect(chat).not.toHaveBeenCalled();
  });
  it("retries malformed JSON once and fails rather than silently spending on a guessed path",async()=>{
    const chat=vi.fn().mockResolvedValue({text:'{"path":"something_else","reason":"bad"}'});
    await expect(planRevision({chat},context)).rejects.toThrow("valid revision strategy");
    expect(chat).toHaveBeenCalledTimes(2);
  });
  it("accepts fenced JSON and recovers from an invalid first result",async()=>{
    const chat=vi.fn().mockResolvedValueOnce({text:"not json"}).mockResolvedValueOnce({text:'```json\n{"path":"edit_latest","reason":"Keep existing appearance"}\n```'});
    expect((await planRevision({chat},context)).path).toBe("edit_latest");
  });
});
it("uses the latest sheet for edits, the original upload for fresh sheets, or no reference for fresh prompt-only sheets",()=>{
  expect(referenceForRevision("edit_latest","latest","original")).toBe("latest");
  expect(referenceForRevision("new_sheet","latest","original")).toBe("original");
  expect(referenceForRevision("new_sheet","latest",null)).toBeNull();
  expect(()=>referenceForRevision("edit_latest",null,"original")).toThrow("missing");
});
it("makes the latest image authoritative for edits and lets new instructions override the original appearance on a fresh start",()=>{
  expect(revisionSheetPrompt("green knight","side_scroller","#FF00FF","shorter cape","edit_latest",true)).toContain("authoritative appearance reference and includes prior revisions");
  expect(revisionSheetPrompt("green knight","top_down","#FF00FF","start over","new_sheet",true)).toContain("Discard prior generated sheet designs");
});
