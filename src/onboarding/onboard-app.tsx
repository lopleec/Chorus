import React, { useState } from "react";
import { Box, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import type { ChorusSettings } from "../config/settings.js";
import { defaultSettings } from "../config/settings.js";

type Step =
  | "agentName"
  | "language"
  | "tone"
  | "provider"
  | "customProviderName"
  | "customProviderUrl"
  | "customProviderApiKey"
  | "customProviderModels"
  | "customProviderFormat"
  | "model"
  | "apiKey"
  | "openaiBaseUrl"
  | "opencode"
  | "strictness"
  | "cooldown"
  | "done";

export interface OnboardAppProps {
  initial?: ChorusSettings;
  onComplete(settings: ChorusSettings): void;
}

export function OnboardApp({ initial = defaultSettings(), onComplete }: OnboardAppProps) {
  const app = useApp();
  const [settings, setSettings] = useState<ChorusSettings>(initial);
  const [step, setStep] = useState<Step>("agentName");
  const [input, setInput] = useState(initial.agentName);
  const [customDraft, setCustomDraft] = useState({ name: "", baseUrl: "", apiKey: "", models: "" });

  const submitText = (value: string) => {
    if (step === "agentName") {
      setSettings({ ...settings, agentName: value.trim() || "Chorus" });
      setInput(settings.tone);
      setStep("language");
      return;
    }
    if (step === "tone") {
      setSettings({ ...settings, tone: value.trim() || "warm, concise, capable" });
      setInput(settings.model ?? "");
      setStep("provider");
      return;
    }
    if (step === "customProviderName") {
      setCustomDraft({ ...customDraft, name: value.trim() });
      setInput("");
      setStep("customProviderUrl");
      return;
    }
    if (step === "customProviderUrl") {
      setCustomDraft({ ...customDraft, baseUrl: value.trim() });
      setInput("");
      setStep("customProviderApiKey");
      return;
    }
    if (step === "customProviderApiKey") {
      setCustomDraft({ ...customDraft, apiKey: value.trim() });
      setInput("");
      setStep("customProviderModels");
      return;
    }
    if (step === "customProviderModels") {
      setCustomDraft({ ...customDraft, models: value.trim() });
      setStep("customProviderFormat");
      return;
    }
    if (step === "model") {
      setSettings({ ...settings, model: value.trim() || undefined });
      setInput(currentApiKey(settings));
      setStep(settings.provider === "mock" ? "opencode" : "apiKey");
      return;
    }
    if (step === "apiKey") {
      const next = { ...settings, apiKeys: { ...settings.apiKeys, [settings.provider]: value.trim() || undefined } };
      setSettings(next);
      setInput(settings.openaiBaseUrl ?? "");
      setStep(settings.provider === "openai" ? "openaiBaseUrl" : "opencode");
      return;
    }
    if (step === "openaiBaseUrl") {
      setSettings({ ...settings, openaiBaseUrl: value.trim() || undefined });
      setStep("opencode");
      return;
    }
    if (step === "cooldown") {
      const minutes = Number.parseInt(value, 10);
      const finalSettings = {
        ...settings,
        security: {
          ...settings.security,
          addonCooldownMinutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : 10
        }
      };
      setSettings(finalSettings);
      setStep("done");
      onComplete(finalSettings);
      app.exit();
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="column">
        <Text color="cyan">Chorus Onboarding</Text>
        <Text>Use arrow keys and Enter for choices. Values are saved to ~/.chorus/config.json.</Text>
      </Box>
      <Box marginTop={1} borderStyle="single" borderColor="green" paddingX={1} flexDirection="column">
        {step === "agentName" && <PromptInput label="Agent name" value={input} setValue={setInput} onSubmit={submitText} />}
        {step === "language" && (
          <SelectInput
            items={[{ label: "中文", value: "zh" }, { label: "English", value: "en" }]}
            onSelect={(item) => {
              setSettings({ ...settings, language: item.value as "zh" | "en" });
              setInput(settings.tone);
              setStep("tone");
            }}
          />
        )}
        {step === "tone" && <PromptInput label="Tone / personality" value={input} setValue={setInput} onSubmit={submitText} />}
        {step === "provider" && (
          <SelectInput
            items={[
              { label: "mock - local testing", value: "mock" },
              { label: "openai", value: "openai" },
              { label: "anthropic", value: "anthropic" },
              { label: "gemini", value: "gemini" },
              ...settings.customProviders.map((provider) => ({ label: `custom: ${provider.name}`, value: `custom:${provider.name}` })),
              { label: "Add custom provider", value: "custom:add" }
            ]}
            onSelect={(item) => {
              if (item.value === "custom:add") {
                setCustomDraft({ name: "", baseUrl: "", apiKey: "", models: "" });
                setInput("");
                setStep("customProviderName");
                return;
              }
              if (String(item.value).startsWith("custom:")) {
                const name = String(item.value).slice("custom:".length);
                const provider = settings.customProviders.find((candidate) => candidate.name === name);
                setSettings({ ...settings, provider: name, model: provider?.models[0] });
                setInput(provider?.models[0] ?? "");
                setStep("opencode");
                return;
              }
              setSettings({ ...settings, provider: item.value as ChorusSettings["provider"] });
              setInput(settings.model ?? defaultModel(item.value));
              setStep("model");
            }}
          />
        )}
        {step === "customProviderName" && <PromptInput label="Provider name" value={input} setValue={setInput} onSubmit={submitText} />}
        {step === "customProviderUrl" && <PromptInput label="Custom base URL" value={input} setValue={setInput} onSubmit={submitText} />}
        {step === "customProviderApiKey" && <PromptInput label="Custom API key (optional)" value={input} setValue={setInput} onSubmit={submitText} />}
        {step === "customProviderModels" && <PromptInput label="Model IDs (comma-separated)" value={input} setValue={setInput} onSubmit={submitText} />}
        {step === "customProviderFormat" && (
          <SelectInput
            items={[
              { label: "OpenAI-compatible chat completions", value: "openai_chat" },
              { label: "Anthropic-compatible messages", value: "anthropic_messages" },
              { label: "Gemini-compatible generateContent", value: "gemini_generate_content" }
            ]}
            onSelect={(item) => {
              const models = customDraft.models.split(",").map((model) => model.trim()).filter(Boolean);
              const provider = {
                name: customDraft.name || "custom",
                baseUrl: customDraft.baseUrl,
                apiKey: customDraft.apiKey || undefined,
                models,
                callFormat: item.value as ChorusSettings["customProviders"][number]["callFormat"]
              };
              setSettings({
                ...settings,
                provider: provider.name,
                model: provider.models[0],
                customProviders: [
                  ...settings.customProviders.filter((existing) => existing.name !== provider.name),
                  provider
                ]
              });
              setInput(provider.models[0] ?? "");
              setStep("opencode");
            }}
          />
        )}
        {step === "model" && <PromptInput label="Default model" value={input} setValue={setInput} onSubmit={submitText} />}
        {step === "apiKey" && <PromptInput label={`${settings.provider.toUpperCase()} API key`} value={input} setValue={setInput} onSubmit={submitText} />}
        {step === "openaiBaseUrl" && <PromptInput label="OpenAI base URL (optional)" value={input} setValue={setInput} onSubmit={submitText} />}
        {step === "opencode" && (
          <SelectInput
            items={[{ label: "Enable OpenCode", value: "yes" }, { label: "Disable OpenCode", value: "no" }]}
            onSelect={(item) => {
              setSettings({ ...settings, opencode: { ...settings.opencode, enabled: item.value === "yes" } });
              setStep("strictness");
            }}
          />
        )}
        {step === "strictness" && (
          <SelectInput
            items={[
              { label: "Block vulnerabilities and malicious behavior", value: "vulnerabilities_block" },
              { label: "Block only clearly malicious behavior", value: "malicious_only" }
            ]}
            onSelect={(item) => {
              setSettings({ ...settings, security: { ...settings.security, reviewStrictness: item.value as ChorusSettings["security"]["reviewStrictness"] } });
              setInput(String(settings.security.addonCooldownMinutes));
              setStep("cooldown");
            }}
          />
        )}
        {step === "cooldown" && <PromptInput label="Addon cooldown minutes" value={input} setValue={setInput} onSubmit={submitText} />}
        {step === "done" && <Text color="green">Saved.</Text>}
      </Box>
    </Box>
  );
}

function PromptInput(props: { label: string; value: string; setValue(value: string): void; onSubmit(value: string): void }) {
  return (
    <Box>
      <Text>{props.label}: </Text>
      <TextInput value={props.value} onChange={props.setValue} onSubmit={props.onSubmit} />
    </Box>
  );
}

function currentApiKey(settings: ChorusSettings): string {
  if (settings.provider === "openai") return settings.apiKeys.openai ?? "";
  if (settings.provider === "anthropic") return settings.apiKeys.anthropic ?? "";
  if (settings.provider === "gemini") return settings.apiKeys.gemini ?? "";
  return "";
}

function defaultModel(provider: string): string {
  if (provider === "openai") return "gpt-4o-mini";
  if (provider === "anthropic") return "claude-3-5-haiku-latest";
  if (provider === "gemini") return "gemini-2.0-flash-001";
  return "mock-model";
}
