cmake_minimum_required(VERSION 3.22)
project("llama_jni")

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Locate or fetch llama.cpp ──────────────────────────────────────
# Priority: 1) env var LLAMA_CPP_DIR  2) local clone  3) FetchContent
if(DEFINED ENV{LLAMA_CPP_DIR})
    set(LLAMA_CPP_DIR "$ENV{LLAMA_CPP_DIR}")
    file(TO_CMAKE_PATH "${LLAMA_CPP_DIR}" LLAMA_CPP_DIR)
    message(STATUS "Using llama.cpp from env LLAMA_CPP_DIR: ${LLAMA_CPP_DIR}")
elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/CMakeLists.txt")
    set(LLAMA_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp")
    file(TO_CMAKE_PATH "${LLAMA_CPP_DIR}" LLAMA_CPP_DIR)
    message(STATUS "Using local llama.cpp clone: ${LLAMA_CPP_DIR}")
else()
    message(STATUS "llama.cpp not found locally. Downloading via FetchContent...")
    include(FetchContent)
    FetchContent_Declare(
        llama_cpp
        GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
        GIT_TAG        master
        GIT_SHALLOW    TRUE
        GIT_PROGRESS   TRUE
        SOURCE_DIR     ${CMAKE_CURRENT_BINARY_DIR}/llama.cpp-src
    )

    # Prevent building examples/tests/models
    set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_SERVER   OFF CACHE BOOL "" FORCE)
    set(BUILD_SHARED_LIBS    OFF CACHE BOOL "" FORCE)

    FetchContent_MakeAvailable(llama_cpp)
    set(LLAMA_CPP_ADDED TRUE)
    set(LLAMA_CPP_DIR "${CMAKE_CURRENT_BINARY_DIR}/llama.cpp-src")
    message(STATUS "llama.cpp fetched to: ${LLAMA_CPP_DIR}")
endif()

# ── Build llama and ggml as static libraries ──────────────────────
set(LLAMA_STANDALONE ON CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL  OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP      OFF CACHE BOOL "" FORCE)

if(NOT LLAMA_CPP_ADDED)
    add_subdirectory(${LLAMA_CPP_DIR} llama_cpp_build)
endif()

# ── Our JNI shared library ────────────────────────────────────────
add_library(llama_jni SHARED
    llama_jni.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/clip.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/mtmd-image.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/mtmd.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/mtmd-audio.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/mtmd-helper.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/deprecation-warning.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/cogvlm.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/conformer.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/deepseekocr.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/deepseekocr2.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/dotsocr.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/exaone4_5.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/gemma4a.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/gemma4ua.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/gemma4uv.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/gemma4v.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/glm4v.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/granite-speech.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/granite4-vision.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/hunyuanvl.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/internvl.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/kimik25.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/kimivl.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/llama4.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/llava.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/minicpmv.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/mimovl.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/mobilenetv5.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/nemotron-v2-vl.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/paddleocr.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/pixtral.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/qwen2vl.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/qwen3a.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/qwen3vl.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/siglip.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/step3vl.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/whisper-enc.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/yasa2.cpp
    ${LLAMA_CPP_DIR}/tools/mtmd/models/youtuvl.cpp
)

target_include_directories(llama_jni PRIVATE
    ${LLAMA_CPP_DIR}/include
    ${LLAMA_CPP_DIR}/ggml/include
    ${LLAMA_CPP_DIR}/vendor/stb
    ${LLAMA_CPP_DIR}/vendor
    ${LLAMA_CPP_DIR}/tools/mtmd
    ${LLAMA_CPP_DIR}/tools/mtmd/models
)

# Link: ggml (static) + llama (static) + log
find_library(log-lib log)
target_link_libraries(llama_jni
    PRIVATE
    ggml
    llama
    ${log-lib}
)

# Strip symbols in release
if(CMAKE_BUILD_TYPE STREQUAL "Release")
    set_target_properties(llama_jni PROPERTIES
        LINK_FLAGS "-s -Wl,--gc-sections"
    )
endif()
