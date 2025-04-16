import { Messages } from "@/types/one-bot";

export type UserBase = {
  symbol: string;
};

type HandlerFunction<U extends UserBase> = (
  user: U,
  params: string[]
) => Promise<Messages> | Messages;

interface CommandStep<U extends UserBase> {
  prompt?: string | ((user: U) => Messages | Promise<Messages>);
  validator?: (input: string, user: U) => string | void | boolean;
  required?: boolean;
  default?: any;
}

interface CommandConfig<U extends UserBase> {
  steps?: CommandStep<U>[];
  validator?: (params: string[], user: U) => string | void | boolean;
}

interface UserState<U extends UserBase> {
  command: string;
  providedParams: string[];
  requiredSteps: number;
  currentStep: number;
  phase: "required" | "optional";
  optionalSteps: number[];
}

export default class CommandHandler<T extends string, U extends UserBase = UserBase> {
  private commands = new Map<
    T,
    {
      config: CommandConfig<U>;
      handler: HandlerFunction<U>;
    }
  >();

  private userStates = new Map<string, UserState<U>>();

  constructor() {}

  register(command: T, config: CommandConfig<U>, handler: HandlerFunction<U>) {
    if (config.steps) {
      let requiredStarted = false;
      for (let i = config.steps.length - 1; i >= 0; i--) {
        const isRequired = config.steps[i].required !== false;
        if (isRequired) {
          requiredStarted = true;
        } else if (requiredStarted) {
          throw new Error("Optional parameters must be consecutive from the end");
        }
      }
    }

    this.commands.set(command, { config, handler });
    return this;
  }

  async handleMessage(user: U, raw: string): Promise<Messages | null> {
    const stateKey = user.symbol;
    const currentState = this.userStates.get(stateKey);

    if (currentState) {
      return this.processStep(user, raw, currentState);
    }

    const [cmd, ...params] = raw.trim().split(/\s+/).filter(Boolean);
    if (!cmd) return null;

    const command = this.commands.get(cmd as T);
    if (!command) return null;

    // 无步骤的直接处理
    if (!command.config.steps) {
      try {
        return command.handler(user, params);
      } catch (e) {
        return `处理失败: ${(e as Error).message}`;
      }
    }

    const requiredSteps = command.config.steps.filter((s) => s.required !== false).length;
    const validParams = this.validateInitialParams(command.config, params, user);

    if (validParams.length >= requiredSteps) {
      return this.executeHandler(user, command, validParams);
    }

    const optionalSteps = command.config.steps.map((_, i) => i).filter((i) => i >= requiredSteps);

    this.userStates.set(stateKey, {
      command: cmd,
      providedParams: validParams,
      requiredSteps,
      currentStep: validParams.length,
      phase: validParams.length < requiredSteps ? "required" : "optional",
      optionalSteps,
    });

    return this.getNextPrompt(command.config, validParams.length, user);
  }

  private async processStep(user: U, input: string, state: UserState<U>): Promise<string> {
    const stateKey = user.symbol;
    const command = this.commands.get(state.command as T);
    if (input.trim().toLowerCase() === "q") {
      this.userStates.delete(stateKey);
      return "";
    }

    if (!command) {
      this.userStates.delete(stateKey);
      return "指令配置错误";
    }

    const result = await (state.phase === "required"
      ? this.processRequiredStep(user, input, state, command)
      : this.processOptionalStep(user, input, state, command));

    if (typeof result === "string") {
      return result;
    }

    return "";
  }

  private async processRequiredStep(
    user: U,
    input: string,
    state: UserState<U>,
    command: { config: CommandConfig<U>; handler: HandlerFunction<U> }
  ): Promise<Messages> {
    const stateKey = user.symbol;
    const stepIndex = state.currentStep;
    const stepConfig = command.config.steps![stepIndex];

    // 必选参数阶段禁止跳过
    if (input.trim().toLowerCase() === "s") {
      return "当前步骤不能跳过，请输入有效内容";
    }

    // 带用户上下文的参数验证
    if (stepConfig.validator) {
      const result = stepConfig.validator(input, user);
      if (result === false) return "参数验证失败，请重新输入";
      else if (typeof result === "string") return result;
    }

    // 更新参数状态
    const newParams = [...state.providedParams];
    newParams[stepIndex] = input;
    const newStep = stepIndex + 1;

    // 继续处理后续必选参数
    if (newStep < state.requiredSteps) {
      this.userStates.set(stateKey, {
        ...state,
        providedParams: newParams,
        currentStep: newStep,
      });
      return this.getNextPrompt(command.config, newStep, user);
    }

    // 准备进入可选参数阶段
    const newState: UserState<U> = {
      ...state,
      providedParams: newParams,
      phase: "optional",
      currentStep: 0,
    };

    // 没有可选参数直接执行
    if (newState.optionalSteps.length === 0) {
      const result = await this.executeHandler(user, command, newParams);
      this.userStates.delete(stateKey); // 状态清理
      return result;
    }

    this.userStates.set(stateKey, newState);
    return this.getOptionalPrompt(command.config, newState.optionalSteps[0], user);
  }

  private async processOptionalStep(
    user: U,
    input: string,
    state: UserState<U>,
    command: { config: CommandConfig<U>; handler: HandlerFunction<U> }
  ): Promise<Messages> {
    const stateKey = user.symbol;
    const lowerInput = input.trim().toLowerCase();

    // 处理立即退出
    if (lowerInput === "s") {
      const filledParams = this.fillOptionalWithDefaults(state, command.config);
      const result = await this.executeHandler(user, command, filledParams);
      this.userStates.delete(stateKey); // 状态清理
      return result;
    }

    const inputs = input.split(/\s+/);
    let currentIndex = state.currentStep;
    const newParams = [...state.providedParams];
    let shouldBreak = false;

    for (const [i, inp] of inputs.entries()) {
      if (currentIndex >= state.optionalSteps.length) break;

      const stepIndex = state.optionalSteps[currentIndex];
      const stepConfig = command.config.steps![stepIndex];

      if (stepConfig.validator) {
        const result = stepConfig.validator(input, user);
        if (result === false) return "参数验证失败，请重新输入";
        else if (typeof result === "string") return result;
      }

      newParams[stepIndex] = inp;
      currentIndex++;

      // 检查后续是否有终止符
      const remaining = inputs.slice(i + 1);
      if (remaining.some((s) => s.toLowerCase() === "s")) {
        shouldBreak = true;
        break;
      }
    }

    // 处理提前终止
    if (shouldBreak || inputs.some((s) => s.toLowerCase() === "s")) {
      const filledParams = this.fillOptionalWithDefaults(
        { ...state, providedParams: newParams, currentStep: currentIndex },
        command.config
      );
      const result = await this.executeHandler(user, command, filledParams);
      this.userStates.delete(stateKey); // 状态清理
      return result;
    }

    // 完成所有可选参数
    if (currentIndex >= state.optionalSteps.length) {
      const result = await this.executeHandler(user, command, newParams);
      this.userStates.delete(stateKey); // 状态清理
      return result;
    }

    // 更新状态继续输入
    this.userStates.set(stateKey, {
      ...state,
      providedParams: newParams,
      currentStep: currentIndex,
    });

    return this.getOptionalPrompt(command.config, state.optionalSteps[currentIndex], user);
  }

  private validateInitialParams(config: CommandConfig<U>, params: string[], user: U): string[] {
    const validParams: string[] = [];
    for (let i = 0; i < params.length; i++) {
      const step = config.steps?.[i];
      if (!step) break;
      if (step.validator && !step.validator(params[i], user)) break;
      validParams.push(params[i]);
    }
    return validParams;
  }

  private fillOptionalWithDefaults(state: UserState<U>, config: CommandConfig<U>): string[] {
    const filled = [...state.providedParams];
    for (let i = state.currentStep; i < state.optionalSteps.length; i++) {
      const stepIndex = state.optionalSteps[i];
      const stepConfig = config.steps![stepIndex];
      if (filled[stepIndex] === undefined && stepConfig.default !== undefined) {
        filled[stepIndex] = stepConfig.default;
      }
    }
    return filled;
  }

  private async getNextPrompt(
    config: CommandConfig<U>,
    stepIndex: number,
    user: U
  ): Promise<Messages> {
    const step = config.steps?.[stepIndex];
    return step?.prompt ? this.getPrompt(step.prompt, user) : `请输入第 ${stepIndex + 1} 个参数：`;
  }

  private async getOptionalPrompt(
    config: CommandConfig<U>,
    stepIndex: number,
    user: U
  ): Promise<Messages> {
    const requiredCount = config.steps?.filter((s) => s.required !== false).length || 0;
    const step = config.steps?.[stepIndex];
    return step?.prompt
      ? this.getPrompt(step.prompt, user)
      : `请输入可选参数（${stepIndex + 1 - requiredCount}）：`;
  }

  private async executeHandler(
    user: U,
    command: {
      config: CommandConfig<U>;
      handler: HandlerFunction<U>;
    },
    params: string[]
  ): Promise<Messages> {
    try {
      const result = command.config.validator?.(params, user);
      if (result === false) return "参数验证失败，请重新输入";
      else if (typeof result === "string") return result;

      return command.handler(user, params);
    } catch (e) {
      return `处理失败: ${(e as Error).message}`;
    } finally {
      const stateKey = user.symbol;
      this.userStates.delete(stateKey);
    }
  }

  private async getPrompt(
    prompt: string | ((user: U) => Messages | Promise<Messages>),
    user: U
  ): Promise<Messages> {
    return typeof prompt === "string" ? prompt : prompt(user);
  }
}
