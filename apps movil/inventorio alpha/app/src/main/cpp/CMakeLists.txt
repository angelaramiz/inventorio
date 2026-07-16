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
    ${LLAMA_CPP_DIR}/tools/mtmd/deprecation-warning.cpp
)

target_include_directories(llama_jni PRIVATE
    ${LLAMA_CPP_DIR}/include
    ${LLAMA_CPP_DIR}/ggml/include
    ${LLAMA_CPP_DIR}/vendor/stb
    ${LLAMA_CPP_DIR}/tools/mtmd
)

# Link: ggml (static) + llama (static) + log
find_library(log-lib log)
target_link_libraries(llama_jni
    PRIVATE
    ggml
    llama
    ${log-lib}
)

# Clip graph vtables use inline virtuals; allow unresolved
set_target_properties(llama_jni PROPERTIES
    LINK_FLAGS "-Wl,-z,undefs"
)

# Strip symbols in release
if(CMAKE_BUILD_TYPE STREQUAL "Release")
    set_target_properties(llama_jni PROPERTIES
        LINK_FLAGS "-s -Wl,--gc-sections"
    )
endif()
