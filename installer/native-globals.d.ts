/** JXA's Objective-C bridge is provided by macOS. Native selector availability
 * is verified by osacompile and actual AppKit review, not this structural check.
 */
declare const $: any;
declare const ObjC: any;
declare const FPDF_INSTALLER_PREVIEW_ONLY: boolean;
declare const module: { exports: unknown };
/** The only backend operations exposed by the native installer. */
type InstallerOperation = 'inspect' | 'install' | 'recover';
/** Stable nonlocalized diagnostic codes; private paths never cross the protocol. */
type InstallerCode = 'invalid-payload' | 'unsafe-path' | 'foreign-item' | 'modified-item' | 'legacy-source-unavailable' | 'owner-mismatch' | 'recovery-conflict' | 'write-failed' | 'operation-failed' | 'interrupted';
/** Optional app presence only, without any readiness or licensing guarantee. */
type InstallerPresence = {hwp:boolean; word:boolean; powerpoint:boolean; excel:boolean};
/** Closed result variants after the strict operation/exit parser accepts them. */
type InstallerOutcome =
  | {kind:'fresh'|'current'|'update'|'legacy'; apps:InstallerPresence}
  | {kind:'conflict'|'recovery-required'|'restored'|'invalid-request'|'failed'; code:InstallerCode}
  | {kind:'installed'|'recovered'|'busy'|'registration-required'};
/** Parsing refusal is distinct from every backend outcome and cannot imply success. */
type InstallerParsed = {kind:'accepted';outcome:InstallerOutcome}|{kind:'protocol-error'};
/** Localization keys and the one allowed mutating action, or no such action. */
type InstallerPresentation = {title:string;body:string;steps:string[];operation:'install'|'recover'|null};
/** One numeric kernel process fact; ownership is established separately by ancestry. */
type InstallerProcessFact = {pid:number;ppid:number;pgid:number;state:string};
/** A descendant fact with its distance from the owned inspection root. */
type InstallerOwnedProcess = InstallerProcessFact & {depth:number};
/** Certified numeric descendants and groups, or refusal when ownership cannot be parsed. */
type InstallerProcessSnapshot = {kind:'owned';processes:InstallerOwnedProcess[]}|{kind:'unavailable'};
/** Pure public decision surface supplied by the concatenated model source. */
declare const FPDFInstallerModel: {
  inspectionProcesses(text:string,rootPID:number):InstallerProcessSnapshot;
  inspectionExpired(operation:InstallerOperation,started:number,now:number):boolean;
  parseReply(text:unknown,operation:unknown,exit:unknown):InstallerParsed;
  present(outcome:InstallerOutcome|{kind:'protocol-error'}):InstallerPresentation;
  language(tags:unknown):'en'|'ko';
};
