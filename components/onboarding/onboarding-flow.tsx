"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronRight, Sparkles, Target, Clock, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { completeOnboarding } from "@/app/(dashboard)/actions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const steps = [
  { id: "welcome", title: "Welcome to Zeroed", icon: Sparkles },
  { id: "goals", title: "Set Your Daily Goals", icon: Target },
  { id: "focus", title: "Focus Duration", icon: Clock },
  { id: "first-task", title: "Create Your First Task", icon: ListTodo },
];

export function OnboardingFlow() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [prefs, setPrefs] = useState({
    dailyGoal: 5,
    focusDuration: 25,
    firstTask: "",
  });

  async function handleComplete() {
    const result = await completeOnboarding(
      {
        daily_goal_tasks: prefs.dailyGoal,
        default_focus_minutes: prefs.focusDuration,
      },
      prefs.firstTask
    );

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Welcome to Zeroed!");
      router.push("/today");
    }
  }

  function next() {
    if (currentStep === steps.length - 1) {
      handleComplete();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  }

  const step = steps[currentStep];
  const Icon = step.icon;

  return (
    <div className="fixed inset-0 bg-background z-50 flex items-center justify-center">
      <div className="w-full max-w-md px-4">
        <Progress value={((currentStep + 1) / steps.length) * 100} className="mb-8" />
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="text-center"
          >
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <Icon className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-4">{step.title}</h1>

            {currentStep === 0 && (
              <p className="text-muted-foreground mb-8">
                Zero your tasks. Focus on what matters. Let's get you set up in just a few steps.
              </p>
            )}

            {currentStep === 1 && (
              <div className="space-y-4">
                <p className="text-muted-foreground mb-4">
                  How many tasks do you want to complete each day?
                </p>
                <div className="flex gap-2 justify-center">
                  {[3, 5, 7, 10].map((n) => (
                    <Button
                      key={n}
                      variant={prefs.dailyGoal === n ? "default" : "outline"}
                      onClick={() => setPrefs({ ...prefs, dailyGoal: n })}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-4">
                <p className="text-muted-foreground mb-4">
                  How long should your focus sessions be?
                </p>
                <div className="flex gap-2 justify-center">
                  {[15, 25, 45, 60].map((m) => (
                    <Button
                      key={m}
                      variant={prefs.focusDuration === m ? "default" : "outline"}
                      onClick={() => setPrefs({ ...prefs, focusDuration: m })}
                    >
                      {m}m
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-4">
                <p className="text-muted-foreground mb-4">
                  What's the first thing you want to accomplish?
                </p>
                <Input
                  placeholder="e.g., Review project proposal"
                  value={prefs.firstTask}
                  onChange={(e) => setPrefs({ ...prefs, firstTask: e.target.value })}
                  className="text-center"
                />
              </div>
            )}

            <Button onClick={next} className="mt-8 w-full" size="lg">
              {currentStep === steps.length - 1 ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Get Started
                </>
              ) : (
                <>
                  Continue
                  <ChevronRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
