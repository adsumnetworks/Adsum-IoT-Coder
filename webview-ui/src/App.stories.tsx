import { HeroUIProvider } from "@heroui/react"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { type ApiConfiguration, bedrockModels } from "@shared/api"
import { CLINE_ONBOARDING_MODELS } from "@shared/cline/onboarding"
import type { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useEffect, useMemo, useState } from "react"
import { expect, userEvent, within } from "storybook/test"
import { ExtensionStateContext, useExtensionState } from "@/context/ExtensionStateContext"
import ChatView from "./components/chat/ChatView"
import OnboardingView from "./components/onboarding/OnboardingView"
import WelcomeView from "./components/welcome/WelcomeView"

// Mock component that mimics App behavior but works in Storybook
const MockApp = () => {
	const { showWelcome, onboardingModels, showAnnouncement } = useExtensionState()

	return (
		<HeroUIProvider>
			{showWelcome ? (
				onboardingModels ? (
					<OnboardingView />
				) : (
					<WelcomeView />
				)
			) : (
				<ChatView
					hideAnnouncement={() => {}}
					isHidden={false}
					showAnnouncement={showAnnouncement}
					showHistoryView={() => {}}
				/>
			)}
		</HeroUIProvider>
	)
}

// Constants
const SIDEBAR_CLASS = "flex flex-col justify-center h-[60%] w-[80%] overflow-hidden"
const ExtensionStateProviderMock = ExtensionStateContext.Provider

const meta: Meta<typeof MockApp> = {
	title: "Views/Chat",
	component: MockApp,
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				component: `
The ChatView component is the main interface for interacting with Cline. It provides a comprehensive chat experience with AI assistance, task management, and various tools.

**Key Features:**
- **Task Management**: Create, resume, and manage AI-assisted tasks
- **Message History**: View conversation history with rich formatting
- **File & Image Support**: Attach files and images to messages
- **Tool Integration**: Execute commands, browse files, and use various tools
- **Auto-approval**: Configure automatic approval for certain actions
- **Streaming Responses**: Real-time AI response streaming
- **Context Management**: Intelligent conversation context handling
- **Plan/Act Modes**: Separate planning and execution phases
- **MCP Integration**: Model Context Protocol server support
- **Browser Automation**: Automated browser interactions
- **Checkpoint System**: Save and restore conversation states

**Use Cases:**
- Software development assistance
- Code review and refactoring
- File system operations
- Web browsing and research
- Task automation
- Learning and exploration

**Note**: In Storybook, some features like file operations, command execution, and API calls are mocked for demonstration purposes.
		`,
			},
		},
	},
	decorators: [
		(Story) => (
			<div className="w-full h-full flex justify-center items-center overflow-hidden">
				<div className={SIDEBAR_CLASS}>
					<Story />
				</div>
			</div>
		),
	],
}

export default meta
type Story = StoryObj<typeof MockApp>

// Mock data factories
const createApiConfig = (overrides: Partial<ApiConfiguration> = {}): ApiConfiguration => ({
	actModeApiProvider: "anthropic",
	actModeApiModelId: "claude-3-5-sonnet-20241022",
	actModeOpenRouterModelInfo: {
		maxTokens: 8000,
		contextWindow: 200000,
		supportsPromptCache: true,
	},
	apiKey: "mock-key",
	...overrides,
})

const mockApiConfiguration = createApiConfig()
const mockApiConfigurationPlan = createApiConfig({
	planModeApiProvider: "anthropic",
	planModeApiModelId: "claude-3-5-sonnet-20241022",
})

const createHistoryItem = (id: string, hoursAgo: number, task: string, metrics: Partial<HistoryItem> = {}): HistoryItem => ({
	id,
	ulid: "01HZZZ1A1B2C3D4E5F6G7H8J9K",
	ts: Date.now() - hoursAgo * 3600000,
	task,
	tokensIn: 2500,
	tokensOut: 1200,
	cacheWrites: 350,
	cacheReads: 180,
	totalCost: 0.085,
	size: 123456,
	...metrics,
})

const mockTaskHistory: HistoryItem[] = [
	createHistoryItem("task-1", 1, "Create a React component for displaying user profiles"),
	createHistoryItem("task-2", 2, "Debug the authentication flow in the login system", {
		tokensIn: 3200,
		tokensOut: 1800,
		cacheWrites: 450,
		cacheReads: 220,
		totalCost: 0.125,
		size: 1234567,
	}),
	createHistoryItem("task-3", 24, "Optimize database queries for better performance", {
		tokensIn: 4500,
		tokensOut: 2400,
		cacheWrites: 680,
		cacheReads: 340,
		totalCost: 0.185,
		size: 12345678,
	}),
]

const createMessage = (
	minutesAgo: number,
	type: ClineMessage["type"],
	say: ClineMessage["say"],
	text: string,
	overrides: Partial<ClineMessage> = {},
): ClineMessage => ({
	ts: Date.now() - minutesAgo * 60000,
	type,
	say,
	text,
	...overrides,
})

const createSayToolMessage = (
	minutesAgo: number,
	sayTool: ClineSayTool,
	overrides: Partial<ClineMessage> = {},
): ClineMessage => ({
	ts: Date.now() - minutesAgo * 60000,
	type: "say",
	say: "tool",
	text: JSON.stringify({
		operationIsLocatedInWorkspace: true,
		...sayTool,
	}),
	...overrides,
})

const createApiReqMessage = (minutesAgo: number, request: string, metrics: any = {}) =>
	createMessage(
		minutesAgo,
		"say",
		"api_req_started",
		JSON.stringify({
			request,
			tokensIn: 19500,
			tokensOut: 4220,
			cacheWrites: 120,
			cacheReads: 60,
			size: 12345,
			cost: 0.025,
			...metrics,
		}),
	)

const mockActiveMessages: ClineMessage[] = [
	createMessage(5, "say", "task", "Help me create a responsive navigation component for a React application"),
	createApiReqMessage(4.9, "Initial analysis request"),
	createMessage(
		4.7,
		"say",
		"text",
		"I'll help you create a responsive navigation component for your React application. Let me start by examining your current project structure and then create a modern, accessible navigation component.",
	),
	createMessage(4.3, "say", "tool", JSON.stringify({ tool: "listFilesTopLevel", path: "src/components" })),
	createApiReqMessage(4.2, "Component creation request", { tokensIn: 12020, tokensOut: 6180, cost: 0.042 }),
	createMessage(
		4,
		"say",
		"text",
		"Based on your project structure, I'll create a responsive navigation component with the following features:\n\n- Mobile-first responsive design\n- Accessible keyboard navigation\n- Smooth animations\n- Support for nested menu items\n- Dark/light theme support",
	),
	createMessage(
		3.7,
		"say",
		"tool",
		JSON.stringify({
			tool: "newFileCreated",
			path: "src/components/Navigation/Navigation.tsx",
			content: "// Navigation component code...",
		}),
	),
	createApiReqMessage(3.5, "Final response request", { tokensIn: 41550, tokensOut: 3320, cost: 0.018 }),
	createMessage(
		3.3,
		"say",
		"text",
		"I've created a responsive navigation component with TypeScript support. The component includes:\n\n✅ Mobile-first responsive design\n✅ Accessible ARIA attributes\n✅ Toggle functionality for mobile\n✅ TypeScript interfaces for type safety\n✅ Theme support\n\nWould you like me to also create the CSS styles for this component?",
	),
]

const mockStreamingMessages: ClineMessage[] = [
	...mockActiveMessages,
	createMessage(
		0.17,
		"say",
		"text",
		"Now I'll create the CSS styles for the navigation component. This will include responsive breakpoints, smooth animations, and accessibility features...",
		{ partial: true },
	),
]

// Reusable state and decorator factories
const createMockState = (overrides: any = {}) => ({
	...useExtensionState(),
	useAutoCondense: true,
	autoCondenseThreshold: 0.5,
	version: "0.0.1-stories",
	welcomeViewCompleted: true,
	showWelcome: false,
	clineMessages: mockActiveMessages,
	taskHistory: mockTaskHistory,
	apiConfiguration: mockApiConfiguration,
	onboardingModels: undefined,
	openRouterModels: bedrockModels,
	showAnnouncement: false,
	backgroundEditEnabled: false,
	...overrides,
})

const createStoryDecorator =
	(stateOverrides: any = {}) =>
	(Story: any) => {
		const mockState = useMemo(() => createMockState(stateOverrides), [])
		return (
			<ExtensionStateProviderMock value={mockState}>
				<div className="w-full h-full flex justify-center items-center overflow-hidden">
					<div className={SIDEBAR_CLASS}>
						<Story />
					</div>
				</div>
			</ExtensionStateProviderMock>
		)
	}

export const Welcome: Story = {
	decorators: [createStoryDecorator({ welcomeViewCompleted: false, showWelcome: true, clineMessages: [] })],
	parameters: {
		docs: {
			description: {
				story: "The welcome screen shown to new users or when no task is active. Displays quick start options and recent task history.",
			},
		},
	},
	args: {},
	// More on component testing: https://storybook.js.org/docs/writing-tests/interaction-testing
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		// Button has vscode-button element name
		const getStartedButton = canvas.getByText("Get Started for Free")
		const byokButton = canvas.getByText("Use your own API key")
		await expect(getStartedButton).toBeInTheDocument()
		await expect(byokButton).toBeInTheDocument()
		await userEvent.click(byokButton)
		await expect(getStartedButton).toBeInTheDocument()
		await expect(byokButton).not.toBeInTheDocument()
	},
}

export const Onboarding: Story = {
	decorators: [
		createStoryDecorator({
			welcomeViewCompleted: false,
			showWelcome: true,
			clineMessages: [],
			onboardingModels: { models: CLINE_ONBOARDING_MODELS },
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "The onboarding flow shown to new users, allowing them to select their preferred AI models and configure initial settings.",
			},
		},
	},
	args: {
		onboardingModels: { models: CLINE_ONBOARDING_MODELS },
	},
	argTypes: {
		onboardingModels: {
			control: { type: "object" },
		},
	},
	// More on component testing: https://storybook.js.org/docs/writing-tests/interaction-testing
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)

		// Step 0: User type selection should be visible
		const title = canvas.getByText("Welcome to Adsum IoT Coder")
		await expect(title).toBeInTheDocument()
	},
}
export const EmptyState: Story = {
	decorators: [createStoryDecorator({ clineMessages: [], taskHistory: [], isNewUser: true, showAnnouncement: true })],
	parameters: {
		docs: {
			description: {
				story: "Shows the empty state for first-time users with no conversation history or active tasks.",
			},
		},
	},
}

export const ReturnUser: Story = {
	decorators: [
		createStoryDecorator({ clineMessages: [], taskHistory: mockTaskHistory, isNewUser: true, showAnnouncement: false }),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows the home screen populated with conversation history for returning users.",
			},
		},
	},
}

export const ActiveConversation: Story = {
	decorators: [createStoryDecorator({ task: mockTaskHistory[0], currentTaskItem: mockTaskHistory[0] })],
	parameters: {
		docs: {
			description: {
				story: "An active conversation showing a typical interaction with Cline, including task creation, tool usage, and AI responses.",
			},
		},
	},
}

export const StreamingResponse: Story = {
	decorators: [createStoryDecorator({ clineMessages: mockStreamingMessages })],
	parameters: {
		docs: {
			description: {
				story: "Shows a streaming response in progress, demonstrating real-time AI response rendering.",
			},
		},
	},
}

const createLongMessages = (): ClineMessage[] => [
	createMessage(30, "say", "task", "Help me build a complete e-commerce application with React, Node.js, and MongoDB"),
	createMessage(
		29.7,
		"say",
		"text",
		"I'll help you build a complete e-commerce application. Let's start by setting up the project structure and implementing the core features step by step.",
	),
	createMessage(
		29.3,
		"say",
		"tool",
		JSON.stringify({ tool: "newFileCreated", path: "package.json", content: "// Package.json content..." }),
	),
	createMessage(
		29,
		"say",
		"text",
		"Great! I've set up the initial package.json. Now let's create the backend server with Express and MongoDB integration.",
	),
	createMessage(
		28.7,
		"say",
		"tool",
		JSON.stringify({ tool: "newFileCreated", path: "server.js", content: "// Express server code..." }),
	),
	createMessage(
		28.3,
		"say",
		"text",
		"Perfect! The backend server is set up. Now let's create the product model and routes for handling product operations.",
	),
	createMessage(
		28,
		"say",
		"tool",
		JSON.stringify({ tool: "newFileCreated", path: "models/Product.js", content: "// Product model code..." }),
	),
	createMessage(
		27.7,
		"say",
		"text",
		"Excellent! The Product model is ready with all necessary fields. Now let's create the React frontend with a modern component structure.",
	),
	createMessage(27.3, "say", "command", "cd client && npx create-react-app . --template typescript"),
	createMessage(27, "say", "command_output", "Creating a new React app... Success! Created client at /path/to/project/client"),
	createMessage(
		26.7,
		"say",
		"text",
		"Great! The React frontend is set up with TypeScript. Now let's create the main components for our e-commerce application.",
	),
]

export const LongConversation: Story = {
	decorators: [createStoryDecorator({ clineMessages: createLongMessages() })],
	parameters: {
		docs: {
			description: {
				story: "A longer conversation showing multiple tool uses, file creation, and command execution in a complex development task.",
			},
		},
	},
}

// Optimized message patterns for common scenarios
const createErrorMessages = () => [
	createMessage(5, "say", "task", "Help me fix the build errors in my React application"),
	createMessage(
		4.7,
		"say",
		"text",
		"I'll help you fix the build errors. Let me first examine the current state of your application.",
	),
	createMessage(4.3, "say", "command", "npm run build"),
	createMessage(4, "say", "error", "Build failed with TypeScript errors in UserProfile.tsx and api.ts"),
	createMessage(
		3.7,
		"say",
		"text",
		"I can see there are TypeScript errors in your code. Let me examine the files and fix these issues.",
	),
	createMessage(3.3, "say", "tool", JSON.stringify({ tool: "readFile", path: "src/components/UserProfile_1.tsx" })),
	createMessage(3.3, "say", "tool", JSON.stringify({ tool: "readFile", path: "src/components/UserProfile_2.tsx" })),
	createMessage(
		3,
		"say",
		"text",
		"I found the issue. The User type doesn't have a 'username' property. Let me fix this by updating the component to use the correct property name.",
	),
]

const createAskMessage = (type: string, text: string, streamingFailedMessage?: string) => ({
	ts: Date.now() - 60000,
	type: "ask" as const,
	ask: type,
	text,
	streamingFailedMessage,
})

export const ErrorState: Story = {
	decorators: [createStoryDecorator({ clineMessages: createErrorMessages() })],
	parameters: {
		docs: {
			description: {
				story: "Shows how Cline handles and displays error messages, helping users understand and resolve issues.",
			},
		},
	},
}

export const AutoApprovalEnabled: Story = {
	decorators: [
		createStoryDecorator({
			autoApprovalSettings: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS,
				enabled: true,
			},
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows the interface with auto-approval enabled, allowing Cline to execute certain actions automatically without user confirmation.",
			},
		},
	},
}

const createPlanModeMessages = () => [
	createMessage(5, "say", "task", "Help me refactor my React application to use TypeScript and improve performance"),
	createApiReqMessage(4.9, "Planning analysis request", { tokensIn: 20000, tokensOut: 19500, cost: 0.065 }),
	createMessage(
		4.7,
		"say",
		"text",
		"I'll help you refactor your React application to use TypeScript and improve performance. Let me create a detailed plan for this migration.",
	),
	createApiReqMessage(4.5, "Detailed planning request", { tokensIn: 20002, tokensOut: 12500, cost: 0.095 }),
	createAskMessage(
		"plan_mode_respond",
		"Here's my comprehensive plan for refactoring your React application with TypeScript migration and performance optimization phases.\n\n\n\n\nPhase 1: TypeScript Migration\n1. Set up TypeScript in the project\n2. Rename .js files to .tsx/.ts\n3. Add type definitions for components and props\n4. Fix type errors and ensure type safety\n\nPhase 2: Performance Optimization\n1. Analyze current performance bottlenecks\n2. Implement code-splitting and lazy loading\n3. Optimize rendering with React.memo and useCallback\n4. Minimize bundle size with tree-shaking and minification\n5. Test performance improvements using profiling tools",
	),
]

export const PlanMode: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: createPlanModeMessages(),
			apiConfiguration: mockApiConfigurationPlan,
			mode: "plan" as const,
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows Cline in Plan mode, where it focuses on creating detailed plans and discussing approaches before implementation.",
			},
		},
	},
}

const createBrowserMessages = () => [
	createMessage(5, "say", "task", "Help me test the login functionality on my web application"),
	createMessage(
		4.7,
		"say",
		"text",
		"I'll help you test the login functionality. Let me launch a browser and navigate to your application.",
	),
	createMessage(4.3, "say", "browser_action_launch", JSON.stringify({ action: "launch", url: "http://localhost:3000/login" })),
	createMessage(
		4,
		"say",
		"browser_action_result",
		JSON.stringify({ currentUrl: "http://localhost:3000/login", logs: "Page loaded successfully" }),
	),
	createMessage(
		3.7,
		"say",
		"text",
		"Great! The browser has launched and navigated to your login page. Now let me test the login functionality.",
	),
	createMessage(3.3, "say", "browser_action", JSON.stringify({ action: "click", coordinate: "400,200" })),
	createMessage(3, "say", "browser_action", JSON.stringify({ action: "type", text: "test@example.com" })),
]

export const BrowserAutomation: Story = {
	decorators: [createStoryDecorator({ clineMessages: createBrowserMessages() })],
	parameters: {
		docs: {
			description: {
				story: "Shows Cline performing browser automation tasks, including launching browsers, clicking elements, and testing web applications.",
			},
		},
	},
}

// Optimized stories using ask message pattern
const createToolApprovalMessages = () => [
	createMessage(5, "say", "task", "Help me read the configuration file"),
	createMessage(4.7, "say", "text", "I need to read a file to understand your configuration."),
	createAskMessage("tool", JSON.stringify({ tool: "readFile", path: "config.json" })),
]

export const ToolApproval: Story = {
	decorators: [createStoryDecorator({ clineMessages: createToolApprovalMessages() })],
	parameters: {
		docs: {
			description: {
				story: "Shows tool approval request with Approve/Reject buttons for file operations.",
			},
		},
	},
}

export const ToolSave: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createMessage(5, "say", "task", "Update the README file with new instructions"),
				createMessage(4.7, "say", "text", "I'll update your README file with the new instructions."),
				createAskMessage("tool", JSON.stringify({ tool: "editedExistingFile", path: "README.md" })),
			],
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows file save request with Save/Reject buttons for file editing operations.",
			},
		},
	},
}

// Quick story generators for common patterns
const quickStory = (
	name: string,
	askType: string,
	text: string,
	description: string,
	streamingFailedMessage?: string,
): Story => ({
	decorators: [
		createStoryDecorator({
			clineMessages: [
				...createLongMessages(),
				createMessage(6, "say", "task", `Help with ${name.toLowerCase()}`),
				createMessage(5, "say", "reasoning", `Thinking about helping user with ${name.toLowerCase()}`),
				createMessage(4.7, "say", "text", `I'll help you with ${name.toLowerCase()}.`),
				createAskMessage(askType, text, streamingFailedMessage),
			],
		}),
	],
	parameters: { docs: { description: { story: description } } },
})

export const CommandExecution: Story = quickStory(
	"Command Execution",
	"command",
	"npm install",
	"Shows command execution request with Run Command/Reject buttons.",
)

export const CommandOutput: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createAskMessage("command", "npm install"),
				createAskMessage("command_output", "Installing packages... This may take a few minutes."),
			],
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows command output with Proceed While Running button during command execution.",
			},
		},
	},
}

// Batch create remaining optimized stories
export const ApiRequestFailed = quickStory(
	"API Request Failed",
	"api_req_failed",
	"API request failed due to network timeout. Would you like to retry?",
	"Shows error recovery options with Retry/Start New Task buttons when API requests fail.",
)
export const MistakeLimitReached = quickStory(
	"Mistake Limit",
	"mistake_limit_reached",
	"I've made several attempts to fix this issue but haven't been successful.",
	"Shows mistake limit reached state with Proceed Anyways/Start New Task options.",
)
export const CompletionResult = quickStory(
	"Task Completion",
	"completion_result",
	"Task completed successfully! I've implemented all the requested features.\n\nWould you like to start a new task?\n\n- View Changes\n- Start New Task\n- Resume Previous Task HAS_CHANGES",
	"Shows task completion state with Start New Task button.",
)
export const BrowserActionLaunch = quickStory(
	"Browser Launch",
	"browser_action_launch",
	"Launch browser to test the website at http://localhost:3000",
	"Shows browser action approval with Approve/Reject buttons for browser launch.",
)
export const McpServerUsage = quickStory(
	"MCP Server",
	"use_mcp_server",
	JSON.stringify({ tool: "get_weather", location: "New York" }),
	"Shows MCP server usage approval with Approve/Reject buttons for external tool usage.",
)
export const Followup = quickStory(
	"Follow-up",
	"followup",
	"What would you like me to work on next?",
	"Shows followup question state where Cline asks for next steps.",
)
export const ResumeTask = quickStory(
	"Resume Task",
	"resume_task",
	"Would you like to resume the previous task?",
	"Shows resume task option for continuing interrupted work.",
)
export const NewTaskWithContext = quickStory(
	"New Task",
	"new_task",
	"Start a new task with the current conversation context",
	"Shows new task creation with context preservation option.",
)
export const ApiRequestActive: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createMessage(5, "say", "text", "Processing your request...", { partial: true }),
				createApiReqMessage(4.7, "Making API request to generate response", { partial: true }),
			],
		}),
	],
	parameters: { docs: { description: { story: "Shows active API request state with Cancel button available." } } },
}
export const PlanModeResponse = quickStory(
	"Plan Mode Response",
	"plan_mode_respond",
	"Here's my comprehensive plan for refactoring your React application with TypeScript migration and performance optimization phases.\n\n\n\n\nPhase 1: TypeScript Migration\n1. Set up TypeScript in the project\n2. Rename .js files to .tsx/.ts\n3. Add type definitions for components and props\n4. Fix type errors and ensure type safety\n\nPhase 2: Performance Optimization\n1. Analyze current performance bottlenecks\n2. Implement code-splitting and lazy loading\n3. Optimize rendering with React.memo and useCallback\n4. Minimize bundle size with tree-shaking and minification\n5. Test performance improvements using profiling tools",
	"Shows plan mode response where Cline presents a detailed plan for user approval.",
)
export const CondenseConversation = quickStory(
	"Condense Conversation",
	"condense",
	"Would you like me to condense the conversation to improve performance?",
	"Shows utility action to condense conversation for better performance.",
)
export const ReportBug = quickStory(
	"Report Bug",
	"report_bug",
	JSON.stringify({
		steps_to_reproduce: "1. Open Cline\n2. Start a new task\n3. Observe the error",
		what_happened: "Cline crashes unexpectedly",
	}),
	"Shows utility action to report bugs to the GitHub repository.",
)
export const ResumeCompletedTask = quickStory(
	"Resume Completed Task type",
	"resume_completed_task",
	"The previous task has been completed. Would you like to start a new task?",
	"Shows Start New Task option for resume completed task.",
)

export const ShellIntegrationWarningWithSuggestion: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createMessage(5, "say", "task", "Run a command"),
				createMessage(4.7, "say", "text", "I'll run the command for you."),
				createMessage(4.5, "say", "shell_integration_warning_with_suggestion", ""),
			],
			vscodeTerminalExecutionMode: "integrated",
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows shell integration warning with suggestion to enable Background Terminal mode.",
			},
		},
	},
}

export const ShellIntegrationWarningBackgroundEnabled: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createMessage(5, "say", "task", "Run a command"),
				createMessage(4.7, "say", "text", "I'll run the command for you."),
				createMessage(4.5, "say", "shell_integration_warning_with_suggestion", ""),
			],
			vscodeTerminalExecutionMode: "backgroundExec",
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows shell integration warning when Background Terminal mode is already enabled.",
			},
		},
	},
}

export const ShellIntegrationWarning: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createMessage(5, "say", "task", "Run a command"),
				createMessage(4.7, "say", "text", "I'll run the command for you."),
				createMessage(4.5, "say", "shell_integration_warning", ""),
			],
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows shell integration unavailable warning with instructions to update VSCode and select a supported shell.",
			},
		},
	},
}

export const ErrorRetryInProgress: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createMessage(5, "say", "task", "Process a request"),
				createMessage(4.7, "say", "text", "Attempting to process your request."),
				createMessage(
					4.5,
					"say",
					"error_retry",
					JSON.stringify({ attempt: 2, maxAttempts: 5, delaySeconds: 10, failed: false }),
				),
			],
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows auto-retry in progress with attempt count and delay.",
			},
		},
	},
}

export const ErrorRetryFailed: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createMessage(5, "say", "task", "Process a request"),
				createMessage(4.7, "say", "text", "Attempting to process your request."),
				createMessage(
					4.5,
					"say",
					"error_retry",
					JSON.stringify({ attempt: 5, maxAttempts: 5, delaySeconds: 0, failed: true }),
				),
			],
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows auto-retry failed after max attempts with manual intervention required.",
			},
		},
	},
}

export const GenerateExplanationInProgress: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createMessage(5, "say", "task", "Explain my recent changes"),
				createMessage(4.7, "say", "text", "I'll generate an explanation of your changes."),
				createMessage(
					4.5,
					"say",
					"generate_explanation",
					JSON.stringify({
						title: "Authentication refactor",
						fromRef: "abc123def",
						toRef: "working directory",
						status: "generating",
					}),
				),
			],
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows explanation generation in progress with spinner.",
			},
		},
	},
}

export const GenerateExplanationComplete: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createMessage(5, "say", "task", "Explain my recent changes"),
				createMessage(4.7, "say", "text", "I'll generate an explanation of your changes."),
				createMessage(
					4.5,
					"say",
					"generate_explanation",
					JSON.stringify({
						title: "Authentication refactor",
						fromRef: "abc123def",
						toRef: "xyz789ghi",
						status: "complete",
					}),
				),
			],
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows successfully generated explanation with git refs.",
			},
		},
	},
}

export const GenerateExplanationError: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createMessage(5, "say", "task", "Explain my recent changes"),
				createMessage(4.7, "say", "text", "I'll generate an explanation of your changes."),
				createMessage(
					4.5,
					"say",
					"generate_explanation",
					JSON.stringify({
						title: "Authentication refactor",
						fromRef: "abc123def",
						toRef: "",
						status: "error",
						error: "Failed to generate explanation: Git repository not found",
					}),
				),
			],
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows explanation generation error with error message.",
			},
		},
	},
}

export const GenerateExplanationCancelled: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createMessage(5, "say", "task", "Explain my recent changes"),
				createMessage(4.7, "say", "text", "I'll generate an explanation of your changes."),
				createMessage(
					4.5,
					"say",
					"generate_explanation",
					JSON.stringify({
						title: "Authentication refactor",
						fromRef: "abc123def",
						toRef: "",
						status: "generating",
					}),
				),
				createMessage(4.3, "ask", undefined, "Task was cancelled", { ask: "resume_task" }),
			],
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows explanation generation cancelled state (detected via resume_task message).",
			},
		},
	},
}

// Diff Edit Stories - New Format
const createNewFormatMultiFileMessages = () => [
	createMessage(5, "say", "task", "Help me refactor the authentication module"),
	createMessage(4.7, "say", "text", "I'll help you refactor the authentication module. Let me make the necessary changes."),
	createSayToolMessage(4.3, {
		tool: "editedExistingFile",
		path: "src/auth/types.ts",
		content: `*** Begin Patch
*** Add File: src/auth/types.ts
+export interface User {
+  id: string
+  email: string
+  role: 'admin' | 'user'
+}
+
+export interface AuthState {
+  user: User | null
+  isAuthenticated: boolean
+}

*** Update File: src/auth/login.ts
@@
-function login(email, password) {
-  return fetch('/api/login', {
+function login(email: string, password: string): Promise<AuthState> {
+  return fetch('/api/login', {
	 method: 'POST',
-    body: { email, password }
+    body: JSON.stringify({ email, password }),
+    headers: { 'Content-Type': 'application/json' }
   })
 }
@@
-export default login
+export { login }

*** Delete File: src/auth/old-utils.js
-function deprecatedHelper() {
-  console.log('This is deprecated')
-}
-
-module.exports = { deprecatedHelper }
*** End Patch`,
	}),
	{ partial: false },
]

export const DiffEditNewFormat: Story = {
	decorators: [createStoryDecorator({ backgroundEditEnabled: true, clineMessages: createNewFormatMultiFileMessages() })],
	parameters: {
		docs: {
			description: {
				story: "Shows the new diff edit format with multiple file operations (Add, Update, Delete) displayed in an organized, expandable view.",
			},
		},
	},
}

export const DiffEditNewFormatStreaming: Story = {
	decorators: [
		(Story) => {
			const [messages, setMessages] = useState<ClineMessage[]>([
				createMessage(5, "say", "task", "Add TypeScript types to the user module"),
				createMessage(4.7, "say", "text", "I'll add TypeScript types to improve type safety."),
			])
			const mockState = useMemo(() => createMockState({ backgroundEditEnabled: true, clineMessages: messages }), [messages])

			useEffect(() => {
				// Simulate streaming: progressively add more content
				const partialPatch = `*** Begin Patch
*** Update File: src/user/profile.ts
@@
-interface UserProfile {
-  name: string
+interface UserProfile {
+  id: string
+  name: string`

				const morePatch =
					partialPatch +
					`
+  email: string
+  createdAt: Date`

				const completePatch =
					morePatch +
					`
+}
*** End Patch`

				// Add initial partial message
				const timer1 = setTimeout(() => {
					setMessages((prev: ClineMessage[]) => [
						...prev,
						createSayToolMessage(
							4.3,
							{
								tool: "editedExistingFile",
								path: "src/user/profile.ts",
								content: partialPatch,
							},
							{ partial: true },
						),
					])
				}, 500)

				// Add more content
				const timer2 = setTimeout(() => {
					setMessages((prev: ClineMessage[]) => {
						const updated = [...prev]
						updated[updated.length - 1] = createSayToolMessage(
							4.3,
							{
								tool: "editedExistingFile",
								path: "src/user/profile.ts",
								content: morePatch,
							},
							{ partial: true },
						)
						return updated
					})
				}, 1500)

				// Complete the patch
				const timer3 = setTimeout(() => {
					setMessages((prev: ClineMessage[]) => {
						const updated = [...prev]
						updated[updated.length - 1] = createSayToolMessage(
							4.3,
							{
								tool: "editedExistingFile",
								path: "src/user/profile.ts",
								content: completePatch,
							},
							{ partial: false },
						)
						return updated
					})
				}, 2500)

				return () => {
					clearTimeout(timer1)
					clearTimeout(timer2)
					clearTimeout(timer3)
				}
			}, [])

			return (
				<ExtensionStateProviderMock value={mockState}>
					<div className="w-full h-full flex justify-center items-center overflow-hidden">
						<div className={SIDEBAR_CLASS}>
							<Story />
						</div>
					</div>
				</ExtensionStateProviderMock>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Shows the new diff edit format while streaming (incomplete patch without End Patch marker).",
			},
		},
	},
}

// Diff Edit Stories - Replace Diff Edit Format
const createReplaceDiffFormatPatchMessages = () => [
	createMessage(5, "say", "task", "Fix the validation logic in the form"),
	createMessage(4.7, "say", "text", "I'll fix the validation logic using the updated pattern."),
	createSayToolMessage(4.3, {
		tool: "editedExistingFile",
		path: "src/auth/types.ts",
		content: `------- SEARCH
function validateEmail(email) {
  return email.includes('@')
}
=======
function validateEmail(email: string): boolean {
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
  return emailRegex.test(email)
}
+++++++ REPLACE`,
	}),
]

export const DiffEditReplaceDiffFormat: Story = {
	decorators: [createStoryDecorator({ backgroundEditEnabled: true, clineMessages: createReplaceDiffFormatPatchMessages() })],
	parameters: {
		docs: {
			description: {
				story: "Shows the old SEARCH/REPLACE diff format (backward compatibility) with complete markers, automatically converted to the new format display.",
			},
		},
	},
}

export const DiffEditReplaceDiffFormatStreaming: Story = {
	decorators: [
		(Story) => {
			const [messages, setMessages] = useState<ClineMessage[]>([
				createMessage(5, "say", "task", "Update error handling"),
				createMessage(4.7, "say", "text", "I'll improve the error handling in the API client."),
			])
			const mockState = useMemo(() => createMockState({ backgroundEditEnabled: true, clineMessages: messages }), [messages])

			useEffect(() => {
				const completePatch = `------- SEARCH
try {
  const response = await fetch(url)
  return response.json()
} catch (error) {
  console.error(error)
}
=======
try {
  const response = await fetch(url)
  if (!response.ok) {
	throw new Error(\`HTTP error! status: \${response.status}\`)
  }
  return response.json()
} catch (error) {
  console.error('API request failed:', error)
  throw error
}
+++++++ REPLACE`

				const patchChunks = completePatch.split("\n")
				let currentIndex = 0

				const intervalId = setInterval(() => {
					if (currentIndex >= patchChunks.length) {
						clearInterval(intervalId)
						return
					}

					setMessages((prev: ClineMessage[]) => {
						const updated = [...prev]
						updated[updated.length - 1] = createSayToolMessage(
							4.3,
							{
								tool: "editedExistingFile",
								path: "src/auth/types.ts",
								content: patchChunks.slice(0, currentIndex + 1).join("\n"),
							},
							{ partial: currentIndex !== patchChunks.length - 1 },
						)
						return updated
					})

					currentIndex++
				}, 500)

				return () => clearInterval(intervalId)
			}, [])

			return (
				<ExtensionStateProviderMock value={mockState}>
					<div className="w-full h-full flex justify-center items-center overflow-hidden">
						<div className={SIDEBAR_CLASS}>
							<Story />
						</div>
					</div>
				</ExtensionStateProviderMock>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Shows the old SEARCH/REPLACE diff format while streaming (incomplete, missing REPLACE marker), demonstrating graceful handling of partial content.",
			},
		},
	},
}

// Combined example showing both formats in one conversation
const createMixedFormatMessages = () => [
	createMessage(5, "say", "task", "Refactor the entire authentication system"),
	createMessage(4.7, "say", "text", "I'll refactor the authentication system. Starting with the login function."),
	createSayToolMessage(4.5, {
		tool: "editedExistingFile",
		path: "src/auth/types.ts",
		content: `------- SEARCH
function login(username, password) {
  return authenticateUser(username, password)
}
=======
async function login(username: string, password: string): Promise<AuthResult> {
  return await authenticateUser(username, password)
}
+++++++ REPLACE`,
	}),
	createMessage(4.3, "say", "text", "Great! Now let me add the type definitions and update the authentication module."),
	createSayToolMessage(4.0, {
		tool: "editedExistingFile",
		path: "src/auth/types.ts",
		content: `*** Begin Patch
*** Add File: src/auth/types.ts
+export interface AuthResult {
+  success: boolean
+  token?: string
+  error?: string
+}
+
+export interface LoginCredentials {
+  username: string
+  password: string
+}

*** Update File: src/auth/authenticate.ts
@@
-function authenticateUser(username, password) {
+async function authenticateUser(username: string, password: string): Promise<AuthResult> {
   // Authentication logic
+  return { success: true, token: 'mock-token' }
 }
*** End Patch`,
	}),
]

export const DiffEditMixedFormats: Story = {
	decorators: [createStoryDecorator({ clineMessages: createMixedFormatMessages() })],
	parameters: {
		docs: {
			description: {
				story: "Shows a conversation using both search / replace and apply patch diff formats, demonstrating seamless backward compatibility and format detection.",
			},
		},
	},
}

/* ------------------------------------------------------------------------------------------
 * The entry cockpit.
 *
 * One story per state the mockup promises, so each can be screenshotted and held against it.
 * These are the states that carry a rule: what a cold start leads with, when the cards give way
 * to a single resume, what happens when the target folder has no history of its own, and what a
 * detected board does to the order of the suggestions.
 * ---------------------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000
const entrySession = (n: number, cwd: string, ageDays: number, task: string) => ({
	id: `story-${n}`,
	ulid: `story-${n}`,
	ts: Date.now() - ageDays * DAY_MS,
	task,
	tokensIn: 1200,
	tokensOut: 300,
	totalCost: 0.01,
	cwdOnTaskInitialization: cwd,
})

const GW = "/home/dev/gateway-fw"
const SENSOR = "/home/dev/sensor-fw"

const entryState = (over: Record<string, unknown>) => ({
	welcomeViewCompleted: true,
	showWelcome: false,
	clineMessages: [],
	...over,
})

/** No folder open and nothing ever run: the samples are the only sensible first offer. */
export const EntryColdStart: Story = {
	decorators: [createStoryDecorator(entryState({ openFolderPaths: [], taskHistory: [] }))],
	args: {},
}

/** Firmware open, nothing run yet: their project leads, the samples step back. */
export const EntryFirstRunWithProject: Story = {
	decorators: [createStoryDecorator(entryState({ openFolderPaths: [GW], taskHistory: [] }))],
	args: {},
}

/** Two fresh sessions: collapsed to the input and one named resume. */
export const EntryReturning: Story = {
	decorators: [
		createStoryDecorator(
			entryState({
				openFolderPaths: [GW],
				taskHistory: [
					entrySession(1, GW, 0.08, "Continue the LEW840x gateway build — Step 5/7 The application"),
					entrySession(2, GW, 3, "Check this build against the CRA"),
				],
			}),
		),
	],
	args: {},
}

/** Away a month: the cards come back rather than making them remember. */
export const EntryLapsed: Story = {
	decorators: [
		createStoryDecorator(
			entryState({
				openFolderPaths: [GW],
				taskHistory: [entrySession(1, GW, 92, "Bring up the BLE scanner"), entrySession(2, GW, 120, "Wi-Fi join")],
			}),
		),
	],
	args: {},
}

/** Sessions exist, but none in the folder they are about to work in. Never a dead resume. */
export const EntryNothingInThisFolder: Story = {
	decorators: [
		createStoryDecorator(
			entryState({
				openFolderPaths: [GW],
				taskHistory: [
					entrySession(1, SENSOR, 1, "sensor-fw — add a shell command"),
					entrySession(2, SENSOR, 4, "sensor-fw — RTT is silent on the /ns build"),
				],
			}),
		),
	],
	args: {},
}

/** A board on the desk outranks everything else, and every suggestion says so. */
export const EntryBoardDetected: Story = {
	decorators: [
		createStoryDecorator(
			entryState({
				openFolderPaths: [GW],
				taskHistory: [],
				nrfEnvironment: {
					status: "ready",
					extensionPresent: true,
					nrfutilPresent: true,
					boards: [{ productName: "nRF52840 DK", serialNumber: "001050288730" }],
				},
			}),
		),
	],
	args: {},
}

/**
 * The states the rig had never rendered, and the ones most likely to break: a long history behind
 * the drawer, more than one folder, and strings a real developer actually produces — a deep path,
 * a pasted stack trace as a task title, a folder name with no spaces to wrap on. Every layout bug
 * this surface has had so far was a short-string layout meeting a long string.
 */
const LONG_TASK =
	"Fix the assertion in zephyr/subsys/bluetooth/host/conn.c:1284 that fires when the peripheral " +
	"disconnects during a GATT write without response and the buffer is still queued"
const DEEP = "/home/dev/customers/northwind/firmware/gateways/lew840x-rev-c/application-esp32-side"

/**
 * The register gate, screens 1–3 of the approved mockup.
 *
 * Anonymous is the default state of this surface, so these are what most people actually see the
 * first time: everything above the cellular group works with no account at all, and the group below
 * says plainly what a free one adds.
 */
export const EntryCellularLocked: Story = {
	decorators: [createStoryDecorator(entryState({ openFolderPaths: [], taskHistory: [], adsumAccount: undefined }))],
	args: {},
}

/** Screen 2 — their own nRF9160 is the reason, so the hint names it rather than advertising. */
export const EntryCellularBoardHint: Story = {
	decorators: [
		createStoryDecorator(
			entryState({
				openFolderPaths: [GW],
				taskHistory: [],
				adsumAccount: undefined,
				nrfEnvironment: {
					status: "ready",
					extensionPresent: true,
					nrfutilPresent: true,
					boards: [{ productName: "nRF9160 DK", serialNumber: "960044501234" }],
				},
			}),
		),
	],
	args: {},
}

/** Screen 3 — the gate itself, opened from the first locked card. */
export const EntryGateOpen: Story = {
	decorators: [createStoryDecorator(entryState({ openFolderPaths: [], taskHistory: [], adsumAccount: undefined }))],
	args: {},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(await canvas.findByTestId("cellular-card-cellularGateway"))
		await expect(await canvas.findByTestId("gate-panel")).toBeTruthy()
	},
}

/**
 * Screen 5 — the minute after signing in: what you unlocked, the one thing you can run now, then the
 * four cards that are no longer locked, and the account chip beside Environment.
 */
export const EntryCellularUnlocked: Story = {
	decorators: [
		createStoryDecorator(
			entryState({
				openFolderPaths: [GW],
				taskHistory: [],
				adsumUnlockedShow: true,
				adsumAccount: {
					email: "ismail@adsumnetworks.com",
					name: "Ismail",
					emailVerified: true,
					groups: ["cellular-advanced", "edge-ai-advanced", "lew840x-demo-hex"],
				},
			}),
		),
	],
	args: {},
}

/** The same person a week later: the one-time card is gone, the demo card and the live cards remain. */
export const EntryRegisteredSettled: Story = {
	decorators: [
		createStoryDecorator(
			entryState({
				openFolderPaths: [GW],
				taskHistory: [],
				adsumUnlockedShow: false,
				adsumAccount: {
					email: "ismail@adsumnetworks.com",
					name: "Ismail",
					emailVerified: true,
					groups: ["cellular-advanced", "edge-ai-advanced", "lew840x-demo-hex"],
				},
			}),
		),
	],
	args: {},
}

/* ------------------------------------------------------------------------------------------
 * The launch sweep, 9 Sep 2026 — one story per rule it introduced, so each is a permanent render
 * in the contact sheet and not a claim in a commit message.
 * ---------------------------------------------------------------------------------------- */

const REGISTERED = {
	email: "ismail@adsumnetworks.com",
	name: "Ismail",
	emailVerified: true,
	groups: ["cellular-advanced", "edge-ai-advanced", "lew840x-demo-hex"],
}

/**
 * The environment line reports the EXCEPTION. A CP2102 bridge is plugged in and esptool got nothing
 * back — the collapsed line must say so in the warning colour, and say nothing else.
 */
export const EntryEspNotAnswering: Story = {
	decorators: [
		createStoryDecorator(
			entryState({
				openFolderPaths: [GW],
				taskHistory: [entrySession(1, GW, 0.1, "Bring up the LEW840x gateway")],
				espEnvironment: {
					status: "ready",
					extensionPresent: true,
					idfPresent: true,
					idfVersion: "6.0.2",
					projectDetected: true,
					espDevices: [
						{
							port: "/dev/cu.usbserial-0001",
							vid: 0x10c4,
							pid: 0xea60,
							serialNumber: "0001",
							probeError: "A fatal error occurred: Failed to connect to Espressif device: No serial data received.",
						},
					],
				},
			}),
		),
	],
	args: {},
}

/**
 * Three notices eligible at once — the receipt, the upgrade card and the review nudge. Exactly ONE
 * may render, and it must be the receipt: it is the answer to something the developer just did.
 * This is the state the operator photographed with two of them stacked.
 */
export const EntryNoticesStacked: Story = {
	decorators: [
		createStoryDecorator(
			entryState({
				openFolderPaths: [GW],
				taskHistory: [],
				adsumAccount: REGISTERED,
				adsumUnlockedShow: true,
				reviewNudgeShow: true,
				showAnnouncement: true,
			}),
		),
	],
	args: {},
}

/** Plenty left: the strip shows once (it discloses who pays) and can be dismissed. */
export const EntryFreeTierHealthy: Story = {
	decorators: [
		createStoryDecorator(
			entryState({
				openFolderPaths: [GW],
				taskHistory: [],
				freeTierRemainingTokens: 6_600_000,
				apiConfiguration: createApiConfig({ actModeApiProvider: "adsum-free", planModeApiProvider: "adsum-free" }),
			}),
		),
	],
	args: {},
}

/** The same install after its first task: the strip has retired and the chip carries the tier. */
export const EntryFreeTierSettled: Story = {
	decorators: [
		createStoryDecorator(
			entryState({
				openFolderPaths: [GW],
				taskHistory: [entrySession(1, GW, 0.3, "Bring up the LEW840x gateway")],
				freeTierRemainingTokens: 6_600_000,
				apiConfiguration: createApiConfig({ actModeApiProvider: "adsum-free", planModeApiProvider: "adsum-free" }),
			}),
		),
	],
	args: {},
}

/** Nearly out: the strip is back whatever was dismissed, because now there is something to do. */
export const EntryFreeTierLow: Story = {
	decorators: [
		createStoryDecorator(
			entryState({
				openFolderPaths: [GW],
				taskHistory: [],
				freeTierRemainingTokens: 40_000,
				apiConfiguration: createApiConfig({ actModeApiProvider: "adsum-free", planModeApiProvider: "adsum-free" }),
			}),
		),
	],
	args: {},
}

export const EntryHeavyHistory: Story = {
	decorators: [
		createStoryDecorator(
			entryState({
				openFolderPaths: [DEEP, SENSOR, GW],
				taskHistory: [
					entrySession(1, DEEP, 0.02, LONG_TASK),
					entrySession(2, DEEP, 0.5, "Step 3/7 — the radio comes up"),
					entrySession(3, DEEP, 1.2, "CRA readiness across the whole build"),
					entrySession(4, DEEP, 2, "esp32-provisioning-over-ble-with-a-very-long-unbroken-identifier"),
					entrySession(5, DEEP, 5, "Why does the modem drop after exactly 30 minutes"),
					entrySession(6, SENSOR, 6, "sensor-fw — add a shell command"),
					entrySession(7, GW, 9, "Bring up the BLE scanner"),
				],
			}),
		),
	],
	args: {},
}
